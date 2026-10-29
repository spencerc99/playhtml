// ABOUTME: Taps through the installed iPhone app like a person: home screen, in-app browser, extension popup, setup.
// ABOUTME: Run by scripts/checkSafariIOSApp.sh against a fresh install, then relaunched to check setup persisted.

import XCTest

final class AppBrowserCheck: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "online.wewere.app")

    override func setUp() {
        continueAfterFailure = false
    }

    /// One continuous run: a fresh install, through setup, then a relaunch.
    func testBrowsingWithTheExtension() {
        app.launch()

        // Home screen, then its button into the app's own browser.
        let start = element("Start browsing")
        XCTAssertTrue(start.waitForExistence(timeout: 20), "home screen shows Start browsing")
        capture("home screen")
        start.tap()

        let address = app.textFields["Address"]
        XCTAssertTrue(address.waitForExistence(timeout: 30), "the browser opens")
        waitFor(address, value: "wewere.online", timeout: 30)

        // Typing an address in the bar loads it.
        address.tap()
        address.typeText("en.wikipedia.org/wiki/Cat\n")
        waitFor(address, value: "en.wikipedia.org", timeout: 30)

        // The content script runs and the background connects it to other
        // people: the people-count pill appears on the page.
        let pill = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label MATCHES %@", ".*[0-9]+ here.*")).firstMatch
        XCTAssertTrue(pill.waitForExistence(timeout: 60), "the presence pill shows on Wikipedia")
        capture("presence pill")

        // A fresh install: the popup offers setup, and setup runs in a sheet.
        let action = app.buttons["extension-action"]
        action.tap()
        tapWhenShown("Open Setup", timeout: 20)
        tapWhenShown("Get started", timeout: 30)
        tapWhenShown("Abstain", timeout: 20)
        tapWhenShown("Continue", timeout: 20)
        tapWhenShown("Finish setup", timeout: 20)

        // Finishing closes the setup sheet without an error.
        XCTAssertTrue(
            element("Finish setup").waitForNonExistence(timeout: 20),
            "setup closes when it finishes"
        )
        XCTAssertFalse(element("Try again").exists, "setup saved without an error")

        // Setup is done: the popup shows the portrait, which opens the
        // trails overlay on the page.
        action.tap()
        let overlay = element("Open Portrait Overlay")
        XCTAssertTrue(overlay.waitForExistence(timeout: 20), "the popup shows the portrait after setup")
        capture("popup after setup")
        overlay.tap()
        let overlayCard = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS[c] '/wiki/cat'")).firstMatch
        XCTAssertTrue(overlayCard.waitForExistence(timeout: 20), "the trails overlay opens on the page")
        capture("trails overlay")

        // Relaunch: setup is remembered, and the browser's close button
        // returns to the home screen.
        app.terminate()
        app.launch()
        XCTAssertTrue(start.waitForExistence(timeout: 20), "the app relaunches to the home screen")
        start.tap()
        XCTAssertTrue(address.waitForExistence(timeout: 30), "the browser opens after relaunch")
        app.buttons["Close the browser"].tap()
        XCTAssertTrue(start.waitForExistence(timeout: 10), "closing the browser returns home")

        start.tap()
        XCTAssertTrue(action.waitForExistence(timeout: 30), "the browser opens again")
        waitFor(address, value: "wewere.online", timeout: 30)
        action.tap()
        XCTAssertTrue(
            element("Open Portrait Overlay").waitForExistence(timeout: 20),
            "setup is remembered after a relaunch"
        )
        XCTAssertFalse(element("Open Setup").exists, "the popup does not ask for setup again")
        capture("popup after relaunch")
    }

    private func element(_ text: String) -> XCUIElement {
        app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func tapWhenShown(_ text: String, timeout: TimeInterval) {
        let target = element(text)
        XCTAssertTrue(target.waitForExistence(timeout: timeout), "\(text) shows")
        target.tap()
    }

    private func waitFor(_ field: XCUIElement, value: String, timeout: TimeInterval) {
        let shown = NSPredicate(format: "value CONTAINS %@", value)
        let expectation = XCTNSPredicateExpectation(predicate: shown, object: field)
        XCTAssertEqual(
            XCTWaiter.wait(for: [expectation], timeout: timeout), .completed,
            "the address bar shows \(value)"
        )
    }

    private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: app.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
