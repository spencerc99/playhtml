# Unreleased

- Slow Mode commute rides now connect reliably when the hosted route loads before the extension.
- Internet Commute now stops counting riders after they leave and always shows the train pull-up and cursor boarding intro for Slow Mode rides.
- Internet Commute now starts a fresh route after returning to home station.
- Internet Commute now keeps active riders together and gives each new train different stops.

<!--
Add a bullet here in any PR that touches extension/**. The release-prep workflow
watches this file: when there are bullets, it opens (or updates) a release PR
that bumps the version, moves these bullets into CHANGELOG.md, and clears this
file back to just the header. Merge that PR to ship.

Format suggestion: "- short user-facing description (#PR)"

For public release-note media, add finished files under
extension/website/public/changelog/media/ and reference them here:

![Screenshot title](/changelog/media/file.png)
![video: Demo title](/changelog/media/file.mp4)
-->

- The commute carriage now has windows you can wipe clear of condensation, and what you draw stays on the glass for other riders until it slowly fogs over again.
- You can look under any seat to read short notes previous riders left there, and tuck one away for whoever sits down next.
- Standing under a hand strap now grabs it automatically — wiggle back and forth to swing higher, and everyone hanging gets thrown forward when the train brakes.
