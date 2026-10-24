// ABOUTME: Shows the app's home page and opens its links in Safari, where the extension runs.
// ABOUTME: packageSafariIOS.sh copies it over the Safari converter's generated view controller.

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        let paper = UIColor(red: 248.0 / 255.0, green: 245.0 / 255.0, blue: 239.0 / 255.0, alpha: 1)
        view.backgroundColor = paper
        webView.isOpaque = false
        webView.backgroundColor = paper
        webView.scrollView.backgroundColor = paper
        webView.scrollView.contentInsetAdjustmentBehavior = .never

        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: "controller")

        webView.loadFileURL(
            Bundle.main.url(forResource: "Main", withExtension: "html")!,
            allowingReadAccessTo: Bundle.main.resourceURL!
        )
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.evaluateJavaScript("show('ios')")
    }

    // Any web link leaves the app for Safari instead of loading in this view.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        if let url = navigationAction.request.url, url.scheme == "https" || url.scheme == "http" {
            openInSafari(url)
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard
            let body = message.body as? [String: Any],
            body["action"] as? String == "open",
            let link = body["url"] as? String,
            let url = URL(string: link),
            url.scheme == "https"
        else { return }
        openInSafari(url)
    }

    // The extension lives in Safari, so prefer Safari even when another
    // browser is the default. x-safari-https opens Safari on iOS 17 and later.
    private func openInSafari(_ url: URL) {
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = "x-safari-" + (url.scheme ?? "https")
        if let safariURL = components?.url {
            UIApplication.shared.open(safariURL) { opened in
                if !opened { UIApplication.shared.open(url) }
            }
        } else {
            UIApplication.shared.open(url)
        }
    }
}
