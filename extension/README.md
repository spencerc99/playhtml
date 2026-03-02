# we were online

A quiet portrait of your time on the internet. This Chrome extension collects traces of how you move, click, scroll, and type across the web, then renders them as living visualizations.

## Install (closed beta)

1. Download and unzip the extension build
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** and select the unzipped `chrome-mv3` folder
5. Pin the extension to your toolbar for easy access

On first install, a setup page opens to configure your preferences.

## What it collects

All collection is **local-first** -- data stays on your device by default. During setup, you choose per-collector whether to keep data local or share it anonymously.

| Collector      | What it captures                                    | Sampling                                                                                    |
| -------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Cursor**     | Movement paths, clicks, holds, cursor style changes | Every 250ms (movement); discrete events for clicks/holds                                    |
| **Keyboard**   | Typing cadence and location in input fields         | Debounced 5s per input; text is abstracted by default (all characters replaced with blocks) |
| **Navigation** | Tab focus/blur, page transitions, screen time       | Discrete events                                                                             |
| **Viewport**   | Scroll position, window resize, zoom level          | Scroll: 100ms; resize: 200ms; zoom: 2s                                                      |

Cursor positions are normalized to 0-1 viewport coordinates. No screenshots or page content are captured.

### Keyboard privacy

Keyboard collection has two modes (configurable during setup):

- **Abstract** (default): All non-whitespace characters are replaced with solid blocks. Preserves typing cadence and rhythm without capturing what you typed.
- **Full**: Actual text is captured, with automatic redaction of emails, phone numbers, and other PII patterns.

## How to use

### Popup

Click the extension icon to open the popup. This shows your identity card and collection status.

### Historical overlay

Press **Cmd+Shift+H** (Mac) or **Ctrl+Shift+H** (Windows/Linux) on any page to toggle the historical overlay. This renders your collected cursor trails, typing, and scroll data as an animated visualization layered on top of the current page.

Collection is paused while the overlay is open so your interaction with the overlay doesn't pollute your data.

## Data and privacy

- All data is stored locally in your browser (IndexedDB within the extension's origin)
- If you chose "share anonymously" during setup, events are uploaded to a server for aggregate visualization.
- You can change collection modes anytime from the popup's profile tab
- Your identity is an anonymous ECDSA keypair generated on install -- no email or account needed

## Known issues (beta)

- The extension requests broad host permissions (`<all_urls>`) to run collectors on all pages. This is required for the content script to function.
- If you change your cursor color in the profile tab, older events will still render with the updated color (colors are applied at render time, not stored per-event).
- Portrait page may take a moment to load if you have a large number of stored events.

## Feedback

Report issues or share feedback at https://github.com/anthropics/playhtml/issues or email directly.
