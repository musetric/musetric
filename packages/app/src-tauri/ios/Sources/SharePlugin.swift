import Tauri
import UIKit
import WebKit

private let handlerName = "musetricShare"
private let sharedArea = "shared"
private let fallbackName = "musetric"
private let encodedFilename = try? NSRegularExpression(pattern: "filename\\*=UTF-8''([^;]+)")

enum ShareError: LocalizedError {
  case downloadFailed
  case unavailable

  var errorDescription: String? {
    switch self {
    case .downloadFailed:
      return "The file could not be downloaded"
    case .unavailable:
      return "Sharing is not available"
    }
  }
}

class SharePlugin: Plugin, WKScriptMessageHandlerWithReply {
  override func load(webview: WKWebView) {
    webview.configuration.userContentController.addScriptMessageHandler(
      self, contentWorld: .page, name: handlerName)
  }

  func userContentController(
    _ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
    replyHandler: @escaping (Any?, String?) -> Void
  ) {
    guard let body = message.body as? [String: Any], let address = body["url"] as? String,
      let url = URL(string: address)
    else {
      replyHandler(nil, "Unsupported share message")
      return
    }
    download(url) { result in
      DispatchQueue.main.async {
        switch result {
        case .success(let file):
          if self.present(file) {
            replyHandler(true, nil)
          } else {
            replyHandler(nil, ShareError.unavailable.localizedDescription)
          }
        case .failure(let error):
          replyHandler(nil, error.localizedDescription)
        }
      }
    }
  }

  private func download(_ url: URL, completion: @escaping (Result<URL, Error>) -> Void) {
    URLSession.shared.downloadTask(with: url) { location, response, error in
      if let error {
        completion(.failure(error))
        return
      }
      guard let location, let http = response as? HTTPURLResponse,
        (200..<300).contains(http.statusCode)
      else {
        completion(.failure(ShareError.downloadFailed))
        return
      }
      do {
        let manager = FileManager.default
        let area = manager.temporaryDirectory.appendingPathComponent(sharedArea, isDirectory: true)
        try? manager.removeItem(at: area)
        try manager.createDirectory(at: area, withIntermediateDirectories: true)
        let file = area.appendingPathComponent(fileName(http))
        try manager.moveItem(at: location, to: file)
        completion(.success(file))
      } catch {
        completion(.failure(error))
      }
    }.resume()
  }

  private func present(_ file: URL) -> Bool {
    guard var top = manager.viewController else {
      return false
    }
    while let presented = top.presentedViewController {
      top = presented
    }
    let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
    if let popover = sheet.popoverPresentationController {
      popover.sourceView = top.view
      popover.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
      popover.permittedArrowDirections = []
    }
    top.present(sheet, animated: true)
    return true
  }
}

private func fileName(_ response: HTTPURLResponse) -> String {
  let header = response.value(forHTTPHeaderField: "Content-Disposition") ?? ""
  let range = NSRange(header.startIndex..., in: header)
  if let match = encodedFilename?.firstMatch(in: header, range: range),
    let captured = Range(match.range(at: 1), in: header),
    let decoded = String(header[captured]).removingPercentEncoding, !decoded.isEmpty
  {
    return decoded.replacingOccurrences(of: "/", with: "_")
  }
  return response.suggestedFilename ?? fallbackName
}

@_cdecl("init_plugin_share")
func initSharePlugin() -> Plugin {
  return SharePlugin()
}
