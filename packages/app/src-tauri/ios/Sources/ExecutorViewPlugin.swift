import Tauri
import UIKit
import WebKit

struct OpenExecutorArgs: Decodable {
  let url: String
}

class ExecutorViewPlugin: Plugin {
  private var url: URL?
  private var shown = false
  private var view: WKWebView?

  override func load(webview: WKWebView) {
    shown = UIApplication.shared.applicationState != .background
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(enterForeground),
      name: UIApplication.willEnterForegroundNotification, object: nil)
    center.addObserver(
      self, selector: #selector(enterBackground),
      name: UIApplication.didEnterBackgroundNotification, object: nil)
    center.addObserver(
      self, selector: #selector(publishThermalState),
      name: ProcessInfo.thermalStateDidChangeNotification, object: nil)
    DispatchQueue.main.async { self.attach() }
  }

  @objc func open(_ invoke: Invoke) throws {
    url = URL(string: try invoke.parseArgs(OpenExecutorArgs.self).url)
    DispatchQueue.main.async { self.attach() }
    invoke.resolve()
  }

  @objc private func enterForeground() {
    shown = true
    attach()
  }

  @objc private func enterBackground() {
    shown = false
    detach()
  }

  @objc private func publishThermalState() {
    DispatchQueue.main.async {
      self.view?.evaluateJavaScript(thermalAssignment())
    }
  }

  private func attach() {
    guard shown, view == nil, let address = url, let root = manager.viewController?.view else {
      return
    }
    let configuration = WKWebViewConfiguration()
    configuration.userContentController.addUserScript(
      WKUserScript(
        source: thermalBridge(), injectionTime: .atDocumentStart, forMainFrameOnly: true))
    let created = WKWebView(
      frame: CGRect(x: 0, y: 0, width: 1, height: 1), configuration: configuration)
    #if DEBUG
      created.isInspectable = true
    #endif
    root.insertSubview(created, at: 0)
    created.load(URLRequest(url: address))
    view = created
  }

  private func detach() {
    guard let attached = view else {
      return
    }
    view = nil
    attached.stopLoading()
    attached.removeFromSuperview()
  }
}

private func thermalAssignment() -> String {
  "globalThis.musetricThermalStatus = \(ProcessInfo.processInfo.thermalState.rawValue);"
}

private func thermalBridge() -> String {
  "\(thermalAssignment()) globalThis.MusetricThermal = { status: () => globalThis.musetricThermalStatus };"
}

@_cdecl("init_plugin_executor_view")
func initPlugin() -> Plugin {
  return ExecutorViewPlugin()
}
