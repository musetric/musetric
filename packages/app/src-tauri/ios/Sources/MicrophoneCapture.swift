import AVFoundation
import UIKit

private let chunkInterval = 0.01
private let ioBufferDuration = 0.005
private let chunkFrameLimit = 4096
private let ringCapacity = 1 << 19
private let stallTicks = 100
private let inputGain: Float = 0.85
private let sessionOptions: AVAudioSession.CategoryOptions = [
  .allowBluetoothA2DP, .mixWithOthers, .defaultToSpeaker,
]

enum MicrophoneError: LocalizedError {
  case permissionDenied
  case inputUnavailable
  case cancelled

  var errorDescription: String? {
    switch self {
    case .permissionDenied:
      return "Microphone access is denied"
    case .inputUnavailable:
      return "No microphone input is available"
    case .cancelled:
      return "Microphone start was cancelled"
    }
  }
}

final class MicrophoneCapture: NSObject {
  var onChunk: ((Int, Int, String) -> Void)?
  var onDeviceChange: (() -> Void)?

  private let engine = AVAudioEngine()
  private let ring = SampleRing(capacity: ringCapacity)
  private var sink: AVAudioSinkNode?
  private var inputFormat: AVAudioFormat?
  private var converter: AVAudioConverter?
  private var timer: DispatchSourceTimer?
  private var running = false
  private var generation = 0
  private var deviceId: String?
  private var session = 0
  private var frame = 0
  private var outputRate = 48000.0
  private var silentTicks = 0

  override init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(routeChanged),
      name: AVAudioSession.routeChangeNotification, object: nil)
    center.addObserver(
      self, selector: #selector(configurationChanged),
      name: .AVAudioEngineConfigurationChange, object: engine)
    center.addObserver(
      self, selector: #selector(interrupted(_:)),
      name: AVAudioSession.interruptionNotification, object: nil)
    center.addObserver(
      self, selector: #selector(resume),
      name: UIApplication.willEnterForegroundNotification, object: nil)
  }

  func devices() -> [String: Any] {
    let audio = AVAudioSession.sharedInstance()
    if !running {
      try? configureCategory()
    }
    let inputs = (audio.availableInputs ?? []).filter { $0.portType != .bluetoothHFP }
    return [
      "inputs": inputs.map(describe),
      "outputs": audio.currentRoute.outputs.map(describe),
    ]
  }

  func start(
    deviceId: String?, sampleRate: Double,
    completion: @escaping (Result<[String: Any], Error>) -> Void
  ) {
    let requested = generation
    requestPermission { granted in
      DispatchQueue.main.async {
        guard requested == self.generation else {
          completion(.failure(MicrophoneError.cancelled))
          return
        }
        guard granted else {
          completion(.failure(MicrophoneError.permissionDenied))
          return
        }
        if !self.running || self.outputRate != sampleRate {
          self.halt()
          self.session += 1
          self.frame = 0
          self.outputRate = sampleRate
          self.ring.reset()
        }
        self.deviceId = deviceId
        self.running = true
        do {
          try self.activate()
          completion(.success(self.describeCapture()))
        } catch {
          self.halt()
          completion(.failure(error))
        }
      }
    }
  }

  func stop() {
    generation += 1
    halt()
  }

  private func activate() throws {
    let audio = AVAudioSession.sharedInstance()
    try configureCategory()
    try? audio.setPreferredIOBufferDuration(ioBufferDuration)
    try audio.setActive(true)
    let inputs = audio.availableInputs ?? []
    let preferred =
      inputs.first { $0.uid == deviceId } ?? inputs.first { $0.portType == .builtInMic }
    if let preferred, audio.preferredInput?.uid != preferred.uid {
      try audio.setPreferredInput(preferred)
    }
    if audio.isInputGainSettable, audio.inputGain != inputGain {
      try? audio.setInputGain(inputGain)
    }
    silentTicks = 0
    try startEngine()
    startTimer()
  }

  private func halt() {
    guard running else {
      return
    }
    running = false
    timer?.cancel()
    timer = nil
    engine.stop()
    detachSink()
    converter = nil
    inputFormat = nil
    try? AVAudioSession.sharedInstance().setActive(false)
  }

  private func configureCategory() throws {
    let audio = AVAudioSession.sharedInstance()
    if audio.category != .playAndRecord || audio.mode != .measurement {
      try audio.setCategory(.playAndRecord, mode: .measurement, options: sessionOptions)
    }
  }

  private func startEngine() throws {
    guard !engine.isRunning else {
      return
    }
    drain()
    detachSink()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0,
      let mono = AVAudioFormat(standardFormatWithSampleRate: format.sampleRate, channels: 1),
      let target = AVAudioFormat(standardFormatWithSampleRate: outputRate, channels: 1)
    else {
      throw MicrophoneError.inputUnavailable
    }
    if inputFormat?.sampleRate != format.sampleRate {
      inputFormat = mono
      converter = format.sampleRate == outputRate ? nil : AVAudioConverter(from: mono, to: target)
      converter?.sampleRateConverterQuality = AVAudioQuality.high.rawValue
    }
    let ring = self.ring
    let rate = format.sampleRate
    let created = AVAudioSinkNode { timestamp, frameCount, list in
      ring.write(list, frameCount: Int(frameCount), timestamp: timestamp.pointee, rate: rate)
      return noErr
    }
    engine.attach(created)
    engine.connect(input, to: created, format: format)
    sink = created
    engine.prepare()
    try engine.start()
  }

  private func detachSink() {
    guard let attached = sink else {
      return
    }
    sink = nil
    engine.disconnectNodeInput(attached)
    engine.detach(attached)
  }

  private func startTimer() {
    guard timer == nil else {
      return
    }
    let created = DispatchSource.makeTimerSource(queue: .main)
    created.schedule(
      deadline: .now() + chunkInterval, repeating: chunkInterval, leeway: .milliseconds(2))
    created.setEventHandler { [weak self] in
      self?.drain()
    }
    created.resume()
    timer = created
  }

  private func drain() {
    guard let format = inputFormat else {
      return
    }
    while let buffer = AVAudioPCMBuffer(
      pcmFormat: format, frameCapacity: AVAudioFrameCount(chunkFrameLimit)),
      let channel = buffer.floatChannelData?[0]
    {
      let taken = ring.read(into: channel, limit: chunkFrameLimit)
      if taken.skipped > 0 {
        frame += Int((Double(taken.skipped) * outputRate / format.sampleRate).rounded())
        converter?.reset()
      }
      guard taken.count > 0 else {
        silentTicks += 1
        if silentTicks >= stallTicks {
          recover()
        }
        return
      }
      silentTicks = 0
      buffer.frameLength = AVAudioFrameCount(taken.count)
      if let converted = convert(buffer) {
        send(converted)
      }
      if taken.count < chunkFrameLimit {
        return
      }
    }
  }

  private func convert(_ buffer: AVAudioPCMBuffer) -> AVAudioPCMBuffer? {
    guard let converter else {
      return buffer
    }
    let capacity = Double(buffer.frameLength) * outputRate / buffer.format.sampleRate
    guard
      let output = AVAudioPCMBuffer(
        pcmFormat: converter.outputFormat, frameCapacity: AVAudioFrameCount(capacity) + 64)
    else {
      return nil
    }
    var consumed = false
    var error: NSError?
    converter.convert(to: output, error: &error) { _, status in
      if consumed {
        status.pointee = .noDataNow
        return nil
      }
      consumed = true
      status.pointee = .haveData
      return buffer
    }
    return error == nil ? output : nil
  }

  private func send(_ buffer: AVAudioPCMBuffer) {
    let count = Int(buffer.frameLength)
    guard count > 0, let channel = buffer.floatChannelData?[0] else {
      return
    }
    let samples = Data(bytes: channel, count: count * MemoryLayout<Float>.size)
    onChunk?(session, frame, samples.base64EncodedString())
    frame += count
  }

  private func describeCapture() -> [String: Any] {
    let audio = AVAudioSession.sharedInstance()
    return [
      "deviceId": audio.currentRoute.inputs.first?.uid ?? "",
      "inputLatency": audio.inputLatency + audio.ioBufferDuration + chunkInterval,
      "outputLatency": audio.outputLatency,
    ]
  }

  private func describe(_ port: AVAudioSessionPortDescription) -> [String: Any] {
    ["id": port.uid, "name": port.portName, "type": port.portType.rawValue]
  }

  private func requestPermission(_ completion: @escaping (Bool) -> Void) {
    AVAudioApplication.requestRecordPermission(completionHandler: completion)
  }

  @objc private func routeChanged() {
    DispatchQueue.main.async {
      self.onDeviceChange?()
    }
  }

  private func recover() {
    silentTicks = 0
    guard running else {
      return
    }
    engine.stop()
    do {
      try activate()
    } catch {
      NSLog("Musetric microphone restart failed: \(error)")
    }
  }

  @objc private func configurationChanged() {
    DispatchQueue.main.async {
      self.recover()
    }
  }

  @objc private func interrupted(_ notification: Notification) {
    let raw = notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt
    guard raw == AVAudioSession.InterruptionType.ended.rawValue else {
      return
    }
    resume()
  }

  @objc private func resume() {
    DispatchQueue.main.async {
      guard !self.engine.isRunning else {
        return
      }
      self.recover()
    }
  }
}
