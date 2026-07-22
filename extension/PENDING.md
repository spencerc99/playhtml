# Unreleased

- Firefox now keeps one reliable browser-session identity without adding warnings to webpage consoles.
- Restored history no longer uploads again, while offline history in imported files stays queued to sync.
- Send bugs, ideas, and other feedback directly from the extension popup.
  ![Feedback button in the extension popup](/changelog/media/feedback-popup-button.png)
  ![Feedback submission confirmation](/changelog/media/feedback-popup-success.png)

<!--
Add a bullet here in any PR that changes the extension itself (extension/src/**
and anything else that ships in the zip). Website (extension/website/**) and
worker (extension/worker/**) changes deploy on their own and do not get
bullets. The release-prep workflow
watches this file: when there are bullets, it opens (or updates) a release PR
that bumps the version, moves these bullets into CHANGELOG.md, and clears this
file back to just the header. Merge that PR to ship.

Format suggestion: "- short user-facing description (#PR)"

For public release-note media, add finished files under
extension/website/public/changelog/media/ and reference them here:

![Screenshot title](/changelog/media/file.png)
![video: Demo title](/changelog/media/file.mp4)
-->

- Fix Wikipedia presence startup while keeping private identity keys out of page-facing payloads.
- Equip the message bottle from your satchel to place it yourself: a faded bottle follows your cursor, and clicking a spot drops it there and opens the letter to write. Back out with "take it back" to remove it.
- A resting bottle now wears its latest letter's paper, closed with a wax seal pressed in the writer's cursor color — and the sealing ceremony stamps that seal on before the letter sinks into the page. An unwritten bottle stays a blank folded card.
