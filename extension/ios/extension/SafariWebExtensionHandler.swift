// ABOUTME: The Safari extension's native side on iPhone: answers its shared folder messages.
// ABOUTME: packageSafariIOS.sh installs this over the handler the Safari packager generates.

import SafariServices

class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: SharedContainer.handle(message, side: "safari")]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
