// ABOUTME: Checks Safari's copy of the extension and the app's copy share one setup and one set of scraps.
// ABOUTME: Run by scripts/checkSafariIOSApp.sh on its own fresh install, after AppBrowserCheck.

import XCTest

final class SafariSyncCheck: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "online.wewere.app")
    private let safari = XCUIApplication(bundleIdentifier: "com.apple.mobilesafari")
    private let settings = XCUIApplication(bundleIdentifier: "com.apple.Preferences")

    override func setUp() {
        continueAfterFailure = false
    }

    func testSafariAndTheAppShareData() {
        turnOnInSafari()

        // Set up in Safari, the way a person starts.
        openInSafari("https://en.wikipedia.org/wiki/Cat")
        openSafariPopup()
        tap("Open Setup", in: safari, timeout: 30)
        tap("Get started", in: safari, timeout: 30)
        tap("Abstain", in: safari, timeout: 20)
        tap("Continue", in: safari, timeout: 20)
        tap("Finish setup", in: safari, timeout: 20)
        XCTAssertTrue(
            element("Finish setup", in: safari).waitForNonExistence(timeout: 20),
            "setup closes in Safari"
        )
        capture("Safari after setup", safari)

        // Browse a page in Safari so it collects scraps from it, then look at
        // them there, which hands them to the shared folder.
        openInSafari("https://en.wikipedia.org/wiki/Fox")
        sleep(15)
        openScraps(in: safari, open: openSafariPopup)
        XCTAssertTrue(scrapFrom("Fox", in: safari).waitForExistence(timeout: 30), "Safari collected scraps from the Fox page")
        capture("Safari scraps", safari)

        // The app's own copy of the extension takes Safari's identity and
        // setup: its popup shows the portrait, not setup.
        app.launch()
        tap("Start browsing", in: app, timeout: 20)
        let address = app.textFields["Address"]
        XCTAssertTrue(address.waitForExistence(timeout: 30), "the app's browser opens")
        address.tap()
        address.typeText("en.wikipedia.org/wiki/Dog\n")
        let action = app.buttons["extension-action"]
        XCTAssertTrue(action.waitForExistence(timeout: 10), "the extension button shows")
        sleep(5)
        action.tap()
        XCTAssertTrue(
            element("Open Portrait Overlay", in: app).waitForExistence(timeout: 30),
            "the app's popup shows the portrait without asking for setup"
        )
        XCTAssertFalse(element("Open Setup", in: app).exists, "the app does not ask for setup")
        capture("app popup after Safari setup", app)

        // The scraps Safari collected show in the app.
        openScraps(in: app, open: { app.buttons["extension-action"].tap() })
        let fox = scrapFrom("Fox", in: app)
        XCTAssertTrue(fox.waitForExistence(timeout: 30), "the app shows the scraps Safari collected")
        capture("app scraps from Safari", app)

        // Deleting them in the app deletes them in Safari too.
        tap("archive", in: app, timeout: 10)
        let search = app.descendants(matching: .any)
            .matching(NSPredicate(format: "placeholderValue CONTAINS 'search words'")).firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "the archive has a search field")
        search.tap()
        search.typeText("Fox\n")
        tap("delete th", in: app, timeout: 10)
        let confirm = app.buttons.matching(NSPredicate(format: "label == 'delete'")).firstMatch
        XCTAssertTrue(confirm.waitForExistence(timeout: 10), "deleting asks to confirm")
        confirm.tap()
        XCTAssertTrue(fox.waitForNonExistence(timeout: 20), "the app deletes the Fox scraps")
        capture("app after deleting", app)

        // Not the Fox page again: visiting it would collect new Fox scraps.
        openInSafari("https://en.wikipedia.org/wiki/Cat")
        openScraps(in: safari, open: openSafariPopup)
        // What the app collected on the Dog page comes the other way.
        XCTAssertTrue(
            scrapFrom("Dog", in: safari).waitForExistence(timeout: 30),
            "Safari shows the scraps the app collected"
        )
        XCTAssertTrue(
            scrapFrom("Fox", in: safari).waitForNonExistence(timeout: 20),
            "Safari no longer shows the scraps deleted in the app"
        )
        capture("Safari after the app deleted", safari)
    }

    /// Opens the scraps page from the extension's popup, opening the popup
    /// first unless it is already up.
    private func openScraps(in target: XCUIApplication, open: () -> Void) {
        let link = target.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS 'your collection' OR label CONTAINS 'view scraps'")).firstMatch
        let announcement = element("internet scraps", in: target)
        if !link.exists && !announcement.exists { open() }
        // The popup links to scraps from its Scraps tile, or from the scraps
        // announcement once it is opened.
        if !link.waitForExistence(timeout: 10), announcement.exists { announcement.tap() }
        XCTAssertTrue(link.waitForExistence(timeout: 20), "the popup links to scraps")
        // The popup opens half height; its lower links come up with a swipe.
        for _ in 0..<4 where !link.isHittable && link.frame.maxY > target.frame.maxY {
            target.swipeUp(velocity: .slow)
        }
        // Safari's popup reports its links as not hittable even on screen, so
        // tap where the link is.
        link.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
    }

    private func scrapFrom(_ page: String, in target: XCUIApplication) -> XCUIElement {
        target.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH 'Examine' AND label CONTAINS %@", page)).firstMatch
    }

    // MARK: Safari

    /// Settings, Apps, Safari, Extensions: allow the extension on every website.
    private func turnOnInSafari() {
        settings.terminate()
        settings.launch()
        scrollTo("Apps", in: settings).tap()
        let search = settings.searchFields.firstMatch
        XCTAssertTrue(search.waitForExistence(timeout: 10), "the Apps list has a search field")
        search.tap()
        search.typeText("Safari")
        scrollTo("Safari", in: settings).tap()
        scrollTo("Extensions", in: settings).tap()
        scrollTo("we were online", in: settings).tap()
        let allow = settings.switches["Allow Extension"]
        XCTAssertTrue(allow.waitForExistence(timeout: 10), "the extension has an Allow switch")
        if (allow.value as? String) != "1" {
            // The row spans the screen; the switch itself sits at its right end.
            allow.coordinate(withNormalizedOffset: CGVector(dx: 0.92, dy: 0.5)).tap()
        }
        let on = XCTNSPredicateExpectation(predicate: NSPredicate(format: "value == '1'"), object: allow)
        XCTAssertEqual(XCTWaiter.wait(for: [on], timeout: 5), .completed, "the extension is allowed")
        scrollTo("All Websites", in: settings).tap()
        scrollTo("Allow", in: settings).tap()
        settings.terminate()
    }

    private func openInSafari(_ address: String) {
        safari.open(URL(string: address)!)
        XCTAssertTrue(safari.wait(for: .runningForeground, timeout: 20), "Safari opens")
    }

    private func openSafariPopup() {
        let pageMenu = safari.buttons.matching(
            NSPredicate(format: "label CONTAINS[c] 'Page Menu' OR identifier CONTAINS[c] 'PageFormat'")
        ).firstMatch
        XCTAssertTrue(pageMenu.waitForExistence(timeout: 20), "Safari shows its page menu button")
        // A tap while the page is still settling can miss the menu.
        let entry = element("we were online", in: safari)
        for _ in 0..<3 where !entry.exists {
            pageMenu.tap()
            _ = entry.waitForExistence(timeout: 5)
        }
        XCTAssertTrue(entry.exists, "Safari's page menu lists we were online")
        entry.tap()
    }

    // MARK: Helpers

    private func element(
        _ text: String, in target: XCUIApplication, type: XCUIElement.ElementType = .any
    ) -> XCUIElement {
        target.descendants(matching: type)
            .matching(NSPredicate(format: "label CONTAINS %@", text)).firstMatch
    }

    private func tap(
        _ text: String, in target: XCUIApplication, timeout: TimeInterval,
        type: XCUIElement.ElementType = .any
    ) {
        let found = element(text, in: target, type: type)
        XCTAssertTrue(found.waitForExistence(timeout: timeout), "\(text) shows")
        found.tap()
    }

    /// Scrolls a list until a row with this label can be tapped. Settings only
    /// lists the rows on screen, so a row further down appears as it scrolls.
    private func scrollTo(_ text: String, in target: XCUIApplication) -> XCUIElement {
        let row = target.descendants(matching: .any)
            .matching(NSPredicate(format: "label == %@", text)).firstMatch
        _ = row.waitForExistence(timeout: 5)
        var tries = 0
        while !(row.exists && row.isHittable) && tries < 10 {
            target.swipeUp(velocity: .slow)
            tries += 1
        }
        XCTAssertTrue(row.exists && row.isHittable, "\(text) is in the list")
        return row
    }

    private func capture(_ name: String, _ target: XCUIApplication) {
        let shot = XCTAttachment(screenshot: target.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }
}
