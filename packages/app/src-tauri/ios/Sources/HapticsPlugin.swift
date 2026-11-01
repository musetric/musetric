import Tauri
import UIKit
import WebKit

private let handlerName = "musetricHaptics"

class HapticsPlugin: Plugin, WKScriptMessageHandler {
  private let selection = UISelectionFeedbackGenerator()
  private let light = UIImpactFeedbackGenerator(style: .light)
  private let medium = UIImpactFeedbackGenerator(style: .medium)

  override func load(webview: WKWebView) {
    webview.configuration.userContentController.add(self, contentWorld: .page, name: handlerName)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage
  ) {
    switch message.body as? String {
    case "tick":
      selection.selectionChanged()
      selection.prepare()
    case "detent":
      light.impactOccurred()
      light.prepare()
    case "grab":
      medium.impactOccurred()
      medium.prepare()
    default:
      break
    }
  }
}

@_cdecl("init_plugin_haptics")
func initHapticsPlugin() -> Plugin {
  return HapticsPlugin()
}
