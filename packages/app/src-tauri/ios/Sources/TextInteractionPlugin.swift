import Tauri
import WebKit

private let handlerName = "musetricTextInteraction"

class TextInteractionPlugin: Plugin, WKScriptMessageHandler {
  private var preferences: WKPreferences?

  override func load(webview: WKWebView) {
    preferences = webview.configuration.preferences
    preferences?.isTextInteractionEnabled = false
    webview.configuration.userContentController.add(self, contentWorld: .page, name: handlerName)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    if let enabled = message.body as? Bool {
      preferences?.isTextInteractionEnabled = enabled
    }
  }
}

@_cdecl("init_plugin_text_interaction")
func initTextInteractionPlugin() -> Plugin {
  return TextInteractionPlugin()
}
