import AVFoundation
import UIKit

private let pollInterval = 0.5
private let tapFrames: AVAudioFrameCount = 4096
private let defaultSeconds = 10.0
private let defaultSampleRate = 48000.0
private let ioBufferDuration = 0.005
private let folderName = "probe"
private let requestName = "request.json"
private let captureName = "capture.json"
private let captureStateName = "capture-state.json"
private let playAndRecordOptions: AVAudioSession.CategoryOptions = [
  .allowBluetoothA2DP, .mixWithOthers, .defaultToSpeaker,
]
private let modes: [String: AVAudioSession.Mode] = [
  "default": .default,
  "gameChat": .gameChat,
  "measurement": .measurement,
  "moviePlayback": .moviePlayback,
  "spokenAudio": .spokenAudio,
  "videoChat": .videoChat,
  "videoRecording": .videoRecording,
  "voiceChat": .voiceChat,
  "voicePrompt": .voicePrompt,
]
private let patterns: [String: AVAudioSession.PolarPattern] = [
  "cardioid": .cardioid,
  "omnidirectional": .omnidirectional,
  "stereo": .stereo,
  "subcardioid": .subcardioid,
]

private struct ProbeError: LocalizedError {
  let message: String

  var errorDescription: String? {
    message
  }
}

private final class ProbeTake {
  private let handle: FileHandle
  private(set) var frames = 0
  private(set) var peak: Float = 0

  init(handle: FileHandle) {
    self.handle = handle
  }

  func append(_ buffer: AVAudioPCMBuffer) {
    guard let channels = buffer.floatChannelData else {
      return
    }
    let count = Int(buffer.frameLength)
    let width = Int(buffer.format.channelCount)
    var samples = [Float](repeating: 0, count: count * width)
    for frame in 0..<count {
      for channel in 0..<width {
        let value = channels[channel][frame]
        samples[frame * width + channel] = value
        peak = max(peak, abs(value))
      }
    }
    samples.withUnsafeBytes { bytes in
      try? handle.write(contentsOf: Data(bytes))
    }
    frames += count
  }

  func close() {
    try? handle.close()
  }
}

final class MicrophoneProbe {
  static var active = false
  static var captureRunning = false

  private var timer: DispatchSourceTimer?
  private var engine: AVAudioEngine?

  private static var folder: URL {
    let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
    return documents.appendingPathComponent(folderName, isDirectory: true)
  }

  private static func captureRequest() -> [String: Any] {
    let url = folder.appendingPathComponent(captureName)
    guard let data = try? Data(contentsOf: url),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    else {
      return [:]
    }
    return request
  }

  static func captureMode() -> AVAudioSession.Mode {
    guard let name = captureRequest()["mode"] as? String, let mode = modes[name] else {
      return .measurement
    }
    return mode
  }

  static func captureGain() -> Float? {
    guard let gain = captureRequest()["inputGain"] as? Double else {
      return nil
    }
    return Float(gain)
  }

  static func writeCaptureState() {
    write(describeSession(), name: captureStateName)
  }

  private static func write(_ report: [String: Any], name: String) {
    let url = folder.appendingPathComponent(name)
    guard JSONSerialization.isValidJSONObject(report),
      let data = try? JSONSerialization.data(
        withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
    else {
      return
    }
    try? data.write(to: url, options: .atomic)
  }

  private static func describeSession() -> [String: Any] {
    let audio = AVAudioSession.sharedInstance()
    return [
      "category": audio.category.rawValue,
      "mode": audio.mode.rawValue,
      "sampleRate": audio.sampleRate,
      "inputLatency": audio.inputLatency,
      "outputLatency": audio.outputLatency,
      "ioBufferDuration": audio.ioBufferDuration,
      "inputChannels": audio.inputNumberOfChannels,
      "inputGain": Double(audio.inputGain),
      "inputGainSettable": audio.isInputGainSettable,
      "route": audio.currentRoute.inputs.map(describePort),
      "outputs": audio.currentRoute.outputs.map(describePort),
      "inputs": (audio.availableInputs ?? []).map(describePort),
    ]
  }

  private static func describePort(_ port: AVAudioSessionPortDescription) -> [String: Any] {
    return [
      "name": port.portName,
      "type": port.portType.rawValue,
      "selected": port.selectedDataSource?.dataSourceName ?? "",
      "sources": (port.dataSources ?? []).map(describeSource),
    ]
  }

  private static func describeSource(
    _ source: AVAudioSessionDataSourceDescription
  ) -> [String: Any] {
    return [
      "name": source.dataSourceName,
      "location": source.location?.rawValue ?? "",
      "orientation": source.orientation?.rawValue ?? "",
      "polarPatterns": (source.supportedPolarPatterns ?? []).map { $0.rawValue },
      "selectedPattern": source.selectedPolarPattern?.rawValue ?? "",
    ]
  }

  func start() {
    try? FileManager.default.createDirectory(
      at: MicrophoneProbe.folder, withIntermediateDirectories: true)
    MicrophoneProbe.write(MicrophoneProbe.describeSession(), name: "ready.json")
    let created = DispatchSource.makeTimerSource(queue: .main)
    created.schedule(deadline: .now() + pollInterval, repeating: pollInterval)
    created.setEventHandler { [weak self] in
      self?.poll()
    }
    created.resume()
    timer = created
  }

  private func poll() {
    UIApplication.shared.isIdleTimerDisabled = true
    guard !MicrophoneProbe.active, !MicrophoneProbe.captureRunning else {
      return
    }
    let url = MicrophoneProbe.folder.appendingPathComponent(requestName)
    guard let data = try? Data(contentsOf: url),
      let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
      let id = request["id"] as? String
    else {
      return
    }
    try? FileManager.default.removeItem(at: url)
    MicrophoneProbe.active = true
    AVAudioApplication.requestRecordPermission(completionHandler: { granted in
      DispatchQueue.main.async {
        self.run(request, id: id, granted: granted)
      }
    })
  }

  private func run(_ request: [String: Any], id: String, granted: Bool) {
    do {
      guard granted else {
        throw ProbeError(message: "Microphone access is denied")
      }
      try record(request, id: id)
    } catch {
      close()
      MicrophoneProbe.write(
        ["id": id, "request": request, "error": error.localizedDescription], name: "\(id).json")
      MicrophoneProbe.active = false
    }
  }

  private func configure(_ request: [String: Any]) throws {
    let audio = AVAudioSession.sharedInstance()
    let modeName = request["mode"] as? String ?? "measurement"
    guard let mode = modes[modeName] else {
      throw ProbeError(message: "Unknown mode \(modeName)")
    }
    let category: AVAudioSession.Category =
      request["category"] as? String == "record" ? .record : .playAndRecord
    let options: AVAudioSession.CategoryOptions = category == .record ? [] : playAndRecordOptions
    try audio.setCategory(category, mode: mode, options: options)
    try audio.setPreferredSampleRate(request["sampleRate"] as? Double ?? defaultSampleRate)
    try? audio.setPreferredIOBufferDuration(ioBufferDuration)
    try audio.setActive(true)
    guard let builtIn = (audio.availableInputs ?? []).first(where: { $0.portType == .builtInMic })
    else {
      throw ProbeError(message: "No built-in microphone")
    }
    try audio.setPreferredInput(builtIn)
    let patternName = request["polarPattern"] as? String
    if let sourceName = request["dataSource"] as? String {
      guard
        let source = builtIn.dataSources?.first(where: { $0.dataSourceName == sourceName })
      else {
        throw ProbeError(message: "Unknown data source \(sourceName)")
      }
      if let patternName {
        guard let pattern = patterns[patternName] else {
          throw ProbeError(message: "Unknown polar pattern \(patternName)")
        }
        try source.setPreferredPolarPattern(pattern)
      }
      try builtIn.setPreferredDataSource(source)
    }
    if patternName == "stereo" {
      try? audio.setPreferredInputNumberOfChannels(2)
    }
    if let gain = request["inputGain"] as? Double, audio.isInputGainSettable {
      try audio.setInputGain(Float(gain))
    }
  }

  private func record(_ request: [String: Any], id: String) throws {
    try configure(request)
    let created = AVAudioEngine()
    let input = created.inputNode
    if request["voiceProcessing"] as? Bool == true {
      try input.setVoiceProcessingEnabled(true)
    }
    let voiceProcessing = input.isVoiceProcessingEnabled
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, format.channelCount > 0 else {
      throw ProbeError(message: "No microphone input is available")
    }
    let url = MicrophoneProbe.folder.appendingPathComponent("\(id).f32")
    FileManager.default.createFile(atPath: url.path, contents: nil)
    let take = ProbeTake(handle: try FileHandle(forWritingTo: url))
    input.installTap(onBus: 0, bufferSize: tapFrames, format: format) { buffer, _ in
      take.append(buffer)
    }
    engine = created
    created.prepare()
    try created.start()
    let started = MicrophoneProbe.describeSession()
    MicrophoneProbe.write(["id": id, "started": started], name: "\(id).started.json")
    let seconds = request["seconds"] as? Double ?? defaultSeconds
    DispatchQueue.main.asyncAfter(deadline: .now() + seconds) {
      let ended = MicrophoneProbe.describeSession()
      self.close()
      take.close()
      let report: [String: Any] = [
        "id": id,
        "request": request,
        "started": started,
        "ended": ended,
        "frames": take.frames,
        "peak": Double(take.peak),
        "channels": Int(format.channelCount),
        "formatSampleRate": format.sampleRate,
        "interleaved": format.isInterleaved,
        "voiceProcessing": voiceProcessing,
      ]
      MicrophoneProbe.write(report, name: "\(id).json")
      MicrophoneProbe.active = false
    }
  }

  private func close() {
    if let running = engine {
      running.inputNode.removeTap(onBus: 0)
      running.stop()
    }
    engine = nil
    try? AVAudioSession.sharedInstance().setActive(false)
  }
}
