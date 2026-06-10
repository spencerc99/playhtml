# Unreleased

<!--
Add a bullet here in any PR that touches extension/**. The release-prep workflow
watches this file: when there are bullets, it opens (or updates) a release PR
that bumps the version, moves these bullets into CHANGELOG.md, and clears this
file back to just the header. Merge that PR to ship.

Format suggestion: "- short user-facing description (#PR)"
-->

- Sign playhtml auth challenges with your identity key so playhtml sites can verify it's really you (permission-gated elements, ownership). The key never leaves the extension; only structured, origin-bound challenges are signed.
