// ABOUTME: The empty app the iPhone app's UI test runs under.
// ABOUTME: The test itself drives the installed we were online app by bundle id.

import SwiftUI

@main
struct HostApp: App {
    var body: some Scene {
        WindowGroup { Text("we were online app check") }
    }
}
