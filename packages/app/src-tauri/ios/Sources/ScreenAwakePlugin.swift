import Tauri
import UIKit
import WebKit

private let handlerName = "musetricScreenAwake"

class ScreenAwakePlugin: Plugin, WKScriptMessageHandler {
  override func load(webview: WKWebView) {
    webview.configuration.userContentController.add(self, contentWorld: .page, name: handlerName)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    if let awake = message.body as? Bool {
      UIApplication.shared.isIdleTimerDisabled = awake
    }
  }
}

@_cdecl("init_plugin_screen_awake")
func initScreenAwakePlugin() -> Plugin {
  return ScreenAwakePlugin()
}
