import Tauri
import UIKit
import WebKit

private let handlerName = "musetricMicrophone"
private let receiver = "globalThis.musetricMicrophone"

class MicrophonePlugin: Plugin, WKScriptMessageHandlerWithReply {
  private weak var page: WKWebView?
  private let capture = MicrophoneCapture()

  override func load(webview: WKWebView) {
    page = webview
    capture.onChunk = { [weak self] session, frame, samples in
      self?.page?.evaluateJavaScript("\(receiver)?.receive(\(session),\(frame),'\(samples)')")
    }
    capture.onDeviceChange = { [weak self] in
      self?.page?.evaluateJavaScript("\(receiver)?.devicechange()")
    }
    webview.configuration.userContentController.addScriptMessageHandler(
      self, contentWorld: .page, name: handlerName)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let type = body["type"] as? String else {
      replyHandler(nil, "Unsupported microphone message")
      return
    }
    switch type {
    case "devices":
      replyHandler(capture.devices(), nil)
    case "start":
      let sampleRate = body["sampleRate"] as? Double ?? 48000
      capture.start(deviceId: body["deviceId"] as? String, sampleRate: sampleRate) { result in
        switch result {
        case .success(let description):
          replyHandler(description, nil)
        case .failure(let error):
          replyHandler(nil, error.localizedDescription)
        }
      }
    case "stop":
      capture.stop()
      replyHandler(true, nil)
    default:
      replyHandler(nil, "Unsupported microphone message")
    }
  }
}

@_cdecl("init_plugin_microphone")
func initMicrophonePlugin() -> Plugin {
  return MicrophonePlugin()
}
