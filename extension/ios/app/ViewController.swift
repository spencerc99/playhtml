// ABOUTME: The iPhone app: a home screen, and a small browser that runs the we were online extension itself.
// ABOUTME: packageSafariIOS.sh installs this over the controller the Safari packager generates.

import UIKit
import WebKit

class ViewController: UIViewController, WKNavigationDelegate {

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        webView.navigationDelegate = self
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false

        let page = Bundle.main.url(forResource: "Main", withExtension: "html")!
        webView.loadFileURL(page, allowingReadAccessTo: Bundle.main.resourceURL!)
    }

    // `-wwoOpen <url>` at launch opens the browser straight to a page, so a
    // simulator run can reach any site without typing into the address bar.
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        let arguments = ProcessInfo.processInfo.arguments
        guard presentedViewController == nil,
              let flag = arguments.firstIndex(of: "-wwoOpen"),
              flag + 1 < arguments.count,
              let url = URL(string: arguments[flag + 1]) else { return }
        openBrowser(at: url)
    }

    private func openBrowser(at url: URL) {
        if #available(iOS 18.4, *) {
            let browser = BrowserViewController(startURL: url)
            browser.modalPresentationStyle = .fullScreen
            present(browser, animated: true)
        } else {
            UIApplication.shared.open(url)
        }
    }

    // Every link on the home screen leads into the web. Where the system can
    // run the extension inside the app, it opens in the app's own browser;
    // otherwise it goes to Safari, where the extension also runs.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url,
              url.scheme == "https" || url.scheme == "http" else {
            decisionHandler(.allow)
            return
        }
        decisionHandler(.cancel)
        openBrowser(at: url)
    }
}

/// Loads the Safari extension this app carries into a web extension
/// controller, so the app's own web views run it the way Safari does.
@available(iOS 18.4, *)
@MainActor
final class ExtensionHost {
    static let shared = ExtensionHost()

    let controller = WKWebExtensionController(configuration: .default())
    private(set) var context: WKWebExtensionContext?
    private var loading: Task<WKWebExtensionContext, Error>?

    func load() async throws -> WKWebExtensionContext {
        if let context { return context }
        if let loading { return try await loading.value }
        let task = Task { @MainActor () throws -> WKWebExtensionContext in
            guard let plugIns = Bundle.main.builtInPlugInsURL,
                  let appex = try FileManager.default
                      .contentsOfDirectory(at: plugIns, includingPropertiesForKeys: nil)
                      .first(where: { $0.pathExtension == "appex" }),
                  let bundle = Bundle(url: appex) else {
                throw BrowserError.extensionMissing
            }
            let webExtension = try await WKWebExtension(appExtensionBundle: bundle)
            let context = WKWebExtensionContext(for: webExtension)
            // Storage is kept per extension identifier, and the default is a
            // new random one each launch, which would wipe setup, history and
            // scraps every time the app opened. Pin both to the extension's id.
            context.uniqueIdentifier = "online.wewere.app.Extension"
            context.baseURL = URL(string: "webkit-extension://online.wewere.app.extension/")!
            // The person installed this app for the extension, so it has the
            // same access here that they grant it in Safari: every site.
            for permission in webExtension.requestedPermissions {
                context.setPermissionStatus(.grantedExplicitly, for: permission)
            }
            for pattern in webExtension.allRequestedMatchPatterns {
                context.setPermissionStatus(.grantedExplicitly, for: pattern)
            }
            context.isInspectable = true
            try controller.load(context)
            return context
        }
        loading = task
        let context = try await task.value
        self.context = context
        return context
    }
}

enum BrowserError: Error {
    case extensionMissing
}

/// The one window the extension sees: the app shows one page at a time.
@available(iOS 18.4, *)
final class BrowserWindow: NSObject, WKWebExtensionWindow {
    weak var tab: BrowserTab?

    func tabs(for context: WKWebExtensionContext) -> [any WKWebExtensionTab] {
        tab.map { [$0] } ?? []
    }

    func activeTab(for context: WKWebExtensionContext) -> (any WKWebExtensionTab)? {
        tab
    }
}

/// The page on screen, as the extension sees it through the tabs API.
@available(iOS 18.4, *)
final class BrowserTab: NSObject, WKWebExtensionTab {
    let webView: WKWebView
    weak var window: BrowserWindow?

    init(webView: WKWebView, window: BrowserWindow) {
        self.webView = webView
        self.window = window
    }

    func window(for context: WKWebExtensionContext) -> (any WKWebExtensionWindow)? { window }
    func webView(for context: WKWebExtensionContext) -> WKWebView? { webView }
    func title(for context: WKWebExtensionContext) -> String? { webView.title }
    func url(for context: WKWebExtensionContext) -> URL? { webView.url }
    func isLoadingComplete(for context: WKWebExtensionContext) -> Bool { !webView.isLoading }

    func loadURL(_ url: URL, for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        webView.load(URLRequest(url: url))
        completionHandler(nil)
    }

    func goBack(for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        webView.goBack()
        completionHandler(nil)
    }

    func goForward(for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        webView.goForward()
        completionHandler(nil)
    }

    func reload(fromOrigin: Bool, for context: WKWebExtensionContext, completionHandler: @escaping (Error?) -> Void) {
        if fromOrigin { webView.reloadFromOrigin() } else { webView.reload() }
        completionHandler(nil)
    }
}

/// A one-page browser with the extension running in it: a bar with close,
/// the address and the extension's button above the page, back and forward below.
@available(iOS 18.4, *)
final class BrowserViewController: UIViewController,
    WKNavigationDelegate, WKUIDelegate, WKWebExtensionControllerDelegate, UITextFieldDelegate {

    private let startURL: URL
    private var webView: WKWebView!
    private var pageTab: BrowserTab?
    private let window = BrowserWindow()
    private let addressField = UITextField()
    private let actionButton = UIButton(type: .system)
    private let backButton = UIButton(type: .system)
    private let forwardButton = UIButton(type: .system)
    private var observations: [NSKeyValueObservation] = []

    private static let ground = UIColor(red: 0.98, green: 0.97, blue: 0.95, alpha: 1)
    private static let ink = UIColor(red: 0.24, green: 0.22, blue: 0.20, alpha: 1)

    init(startURL: URL) {
        self.startURL = startURL
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("BrowserViewController is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = Self.ground
        Task { await start() }
    }

    private func start() async {
        let host = ExtensionHost.shared
        do {
            _ = try await host.load()
        } catch {
            // Without the extension this is just a browser, which is not the
            // point of the app; Safari still runs the extension.
            dismiss(animated: true) { UIApplication.shared.open(self.startURL) }
            return
        }
        host.controller.delegate = self

        let configuration = WKWebViewConfiguration()
        configuration.webExtensionController = host.controller
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.allowsBackForwardNavigationGestures = true
        webView.isInspectable = true

        let tab = BrowserTab(webView: webView, window: window)
        self.pageTab = tab
        window.tab = tab
        host.controller.didOpenWindow(window)
        host.controller.didFocusWindow(window)
        host.controller.didOpenTab(tab)
        host.controller.didActivateTab(tab, previousActiveTab: nil)

        layout()
        observe()
        webView.load(URLRequest(url: startURL))
    }

    private func layout() {
        let close = UIButton(type: .system)
        close.setImage(UIImage(systemName: "xmark"), for: .normal)
        close.accessibilityLabel = "Close the browser"
        close.addAction(UIAction { [weak self] _ in self?.close() }, for: .touchUpInside)

        addressField.font = .systemFont(ofSize: 15)
        addressField.textColor = Self.ink
        addressField.backgroundColor = UIColor(red: 0.95, green: 0.93, blue: 0.89, alpha: 1)
        addressField.layer.cornerRadius = 10
        addressField.leftView = UIView(frame: CGRect(x: 0, y: 0, width: 12, height: 1))
        addressField.leftViewMode = .always
        addressField.keyboardType = .webSearch
        addressField.autocapitalizationType = .none
        addressField.autocorrectionType = .no
        addressField.returnKeyType = .go
        addressField.clearButtonMode = .whileEditing
        addressField.delegate = self
        addressField.accessibilityLabel = "Address"

        // The extension's own icon, in its colors rather than tinted.
        actionButton.setImage(
            ExtensionHost.shared.context?.webExtension
                .actionIcon(for: CGSize(width: 26, height: 26))?
                .withRenderingMode(.alwaysOriginal)
                ?? UIImage(systemName: "circle.dotted"),
            for: .normal
        )
        actionButton.accessibilityLabel = "we were online"
        actionButton.addAction(UIAction { [weak self] _ in self?.openExtensionPopup() }, for: .touchUpInside)

        let top = UIStackView(arrangedSubviews: [close, addressField, actionButton])
        top.axis = .horizontal
        top.spacing = 10
        top.alignment = .center

        backButton.setImage(UIImage(systemName: "chevron.left"), for: .normal)
        backButton.accessibilityLabel = "Back"
        backButton.addAction(UIAction { [weak self] _ in self?.webView.goBack() }, for: .touchUpInside)
        forwardButton.setImage(UIImage(systemName: "chevron.right"), for: .normal)
        forwardButton.accessibilityLabel = "Forward"
        forwardButton.addAction(UIAction { [weak self] _ in self?.webView.goForward() }, for: .touchUpInside)
        let bottom = UIStackView(arrangedSubviews: [backButton, forwardButton, UIView()])
        bottom.axis = .horizontal
        bottom.spacing = 28

        for item in [close, actionButton, backButton, forwardButton] {
            item.tintColor = Self.ink
            item.widthAnchor.constraint(equalToConstant: 44).isActive = true
            item.heightAnchor.constraint(equalToConstant: 44).isActive = true
        }

        for item in [top, webView!, bottom] as [UIView] {
            item.translatesAutoresizingMaskIntoConstraints = false
            view.addSubview(item)
        }
        let guide = view.safeAreaLayoutGuide
        NSLayoutConstraint.activate([
            top.topAnchor.constraint(equalTo: guide.topAnchor, constant: 4),
            top.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 8),
            top.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -8),
            addressField.heightAnchor.constraint(equalToConstant: 40),
            webView.topAnchor.constraint(equalTo: top.bottomAnchor, constant: 4),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: bottom.topAnchor),
            bottom.leadingAnchor.constraint(equalTo: guide.leadingAnchor, constant: 16),
            bottom.trailingAnchor.constraint(equalTo: guide.trailingAnchor, constant: -16),
            bottom.bottomAnchor.constraint(equalTo: guide.bottomAnchor),
        ])
    }

    // The extension hears about the page through the tab, the way it would
    // in Safari: what it is, where it is, and when it finishes loading.
    private func observe() {
        observations = [
            webView.observe(\.url) { [weak self] webView, _ in
                Task { @MainActor in
                    self?.showAddress(webView.url)
                    self?.tabChanged(.URL)
                }
            },
            webView.observe(\.title) { [weak self] _, _ in
                Task { @MainActor in self?.tabChanged(.title) }
            },
            webView.observe(\.isLoading) { [weak self] _, _ in
                Task { @MainActor in self?.tabChanged(.loading) }
            },
            webView.observe(\.canGoBack) { [weak self] webView, _ in
                Task { @MainActor in self?.backButton.isEnabled = webView.canGoBack }
            },
            webView.observe(\.canGoForward) { [weak self] webView, _ in
                Task { @MainActor in self?.forwardButton.isEnabled = webView.canGoForward }
            },
        ]
    }

    private func tabChanged(_ properties: WKWebExtension.TabChangedProperties) {
        guard let tab = pageTab else { return }
        ExtensionHost.shared.controller.didChangeTabProperties(properties, for: tab)
    }

    private func showAddress(_ url: URL?) {
        guard !addressField.isEditing else { return }
        addressField.text = url?.host() ?? url?.absoluteString
    }

    private func openExtensionPopup() {
        guard let tab = pageTab, let context = ExtensionHost.shared.context else { return }
        context.performAction(for: tab)
    }

    private func close() {
        let controller = ExtensionHost.shared.controller
        if let tab = pageTab {
            controller.didCloseTab(tab, windowIsClosing: true)
        }
        controller.didCloseWindow(window)
        dismiss(animated: true)
    }

    // MARK: Address

    func textFieldDidBeginEditing(_ textField: UITextField) {
        textField.text = webView.url?.absoluteString
        textField.selectAll(nil)
    }

    func textFieldShouldReturn(_ textField: UITextField) -> Bool {
        textField.resignFirstResponder()
        let typed = (textField.text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty else { return true }
        let url: URL?
        if typed.contains(" ") || !typed.contains(".") {
            var search = URLComponents(string: "https://duckduckgo.com/")!
            search.queryItems = [URLQueryItem(name: "q", value: typed)]
            url = search.url
        } else if typed.hasPrefix("http://") || typed.hasPrefix("https://") {
            url = URL(string: typed)
        } else {
            url = URL(string: "https://" + typed)
        }
        if let url { webView.load(URLRequest(url: url)) }
        return true
    }

    func textFieldDidEndEditing(_ textField: UITextField) {
        showAddress(webView.url)
    }

    // MARK: Pages that open new windows

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        // One page at a time: a link meant for a new window opens here.
        if navigationAction.targetFrame == nil {
            webView.load(navigationAction.request)
        }
        return nil
    }

    /// The extension's own pages (setup, portrait, history, scraps) need a
    /// web view made from the extension's configuration, so they open in a
    /// sheet over the browser; web pages replace the current page.
    private func open(_ url: URL?, from context: WKWebExtensionContext) {
        guard let url else { return }
        let show = { [weak self] in
            guard let self else { return }
            if url.scheme == context.baseURL.scheme,
               let configuration = context.webViewConfiguration {
                let page = ExtensionPageViewController(url: url, configuration: configuration)
                page.modalPresentationStyle = .pageSheet
                self.present(page, animated: true)
            } else {
                self.webView.load(URLRequest(url: url))
            }
        }
        if let presented = presentedViewController {
            presented.dismiss(animated: true, completion: show)
        } else {
            show()
        }
    }

    // MARK: WKWebExtensionControllerDelegate

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewWindowUsing configuration: WKWebExtension.WindowConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping ((any WKWebExtensionWindow)?, Error?) -> Void
    ) {
        open(configuration.tabURLs.first, from: extensionContext)
        completionHandler(window, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        openWindowsFor extensionContext: WKWebExtensionContext
    ) -> [any WKWebExtensionWindow] {
        [window]
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        focusedWindowFor extensionContext: WKWebExtensionContext
    ) -> (any WKWebExtensionWindow)? {
        window
    }

    // The popup's links to the portrait, history and scraps pages open in
    // place of the current page, since the app shows one page at a time.
    func webExtensionController(
        _ controller: WKWebExtensionController,
        openNewTabUsing configuration: WKWebExtension.TabConfiguration,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping ((any WKWebExtensionTab)?, Error?) -> Void
    ) {
        open(configuration.url, from: extensionContext)
        completionHandler(pageTab, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissions permissions: Set<WKWebExtension.Permission>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<WKWebExtension.Permission>, Date?) -> Void
    ) {
        completionHandler(permissions, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        promptForPermissionToAccess urls: Set<URL>,
        in tab: (any WKWebExtensionTab)?,
        for extensionContext: WKWebExtensionContext,
        completionHandler: @escaping (Set<URL>, Date?) -> Void
    ) {
        completionHandler(urls, nil)
    }

    func webExtensionController(
        _ controller: WKWebExtensionController,
        presentActionPopup action: WKWebExtension.Action,
        for context: WKWebExtensionContext,
        completionHandler: @escaping (Error?) -> Void
    ) {
        guard let popup = action.popupViewController else {
            completionHandler(BrowserError.extensionMissing)
            return
        }
        if let sheet = popup.sheetPresentationController {
            sheet.detents = [.medium(), .large()]
            sheet.prefersGrabberVisible = true
        }
        present(popup, animated: true)
        completionHandler(nil)
    }
}

/// One of the extension's own pages, shown in a sheet with a close button.
@available(iOS 18.4, *)
final class ExtensionPageViewController: UIViewController {
    private let url: URL
    private let configuration: WKWebViewConfiguration

    init(url: URL, configuration: WKWebViewConfiguration) {
        self.url = url
        self.configuration = configuration
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("ExtensionPageViewController is created in code")
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)

        let close = UIButton(type: .close)
        close.accessibilityLabel = "Close"
        close.addAction(UIAction { [weak self] _ in self?.dismiss(animated: true) }, for: .touchUpInside)
        close.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(close)

        NSLayoutConstraint.activate([
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            close.topAnchor.constraint(equalTo: view.safeAreaLayoutGuide.topAnchor, constant: 8),
            close.trailingAnchor.constraint(equalTo: view.safeAreaLayoutGuide.trailingAnchor, constant: -12),
            close.widthAnchor.constraint(equalToConstant: 44),
            close.heightAnchor.constraint(equalToConstant: 44),
        ])
        webView.load(URLRequest(url: url))
    }
}
