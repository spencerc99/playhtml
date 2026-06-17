# Unreleased

<!--
Add a bullet here in any PR that touches extension/**. The release-prep workflow
watches this file: when there are bullets, it opens (or updates) a release PR
that bumps the version, moves these bullets into CHANGELOG.md, and clears this
file back to just the header. Merge that PR to ship.

Format suggestion: "- short user-facing description (#PR)"
-->
- Reduced background CPU and storage work while collecting browsing activity.
- Stopped hidden inventory development features from observing and writing on every page.
- Preserved pending event uploads when upgrading existing local browsing databases.
- Stored click events sooner to avoid losing them during fast page exits.
- Cursor trails now render as smooth, hand-drawn ink strokes with tapered ends (perfect-freehand)
- Fixed the data collection settings panel to show local storage usage and stored event counts.
