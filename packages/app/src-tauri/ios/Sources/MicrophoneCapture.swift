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
  var onChunk: ((Int, Int, Double, String) -> Void)?
  var onDeviceChange: (() -> Void)?

  private let engine = AVAudioEngine()
  private let ring = SampleRing(capacity: ringCapacity)
  private var sink: AVAudioSinkNode?
  private var inputRate: Double?
  private var chunk = [Float](repeating: 0, count: chunkFrameLimit)
  private var timer: DispatchSourceTimer?
  private var running = false
  private var generation = 0
  private var deviceId: String?
  private var session = 0
  private var frame = 0
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
    deviceId: String?,
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
        if !self.running {
          self.startSession()
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
    inputRate = nil
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
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw MicrophoneError.inputUnavailable
    }
    let rate = format.sampleRate
    if let previous = inputRate, previous != rate {
      startSession()
    }
    inputRate = rate
    let ring = self.ring
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

  private func startSession() {
    session += 1
    frame = 0
    ring.reset()
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
    guard let rate = inputRate else {
      return
    }
    while true {
      let taken = ring.read(into: &chunk, limit: chunkFrameLimit)
      frame += taken.skipped
      guard taken.count > 0 else {
        silentTicks += 1
        if silentTicks >= stallTicks {
          recover()
        }
        return
      }
      silentTicks = 0
      send(count: taken.count, rate: rate)
      if taken.count < chunkFrameLimit {
        return
      }
    }
  }

  private func send(count: Int, rate: Double) {
    let samples = chunk.withUnsafeBytes { Data($0.prefix(count * MemoryLayout<Float>.size)) }
    onChunk?(session, frame, rate, samples.base64EncodedString())
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
