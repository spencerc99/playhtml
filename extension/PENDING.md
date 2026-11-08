# Unreleased

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

- Collage exports are much smaller: front and back pictures now save as high-quality JPEGs around 1-2MB instead of 7-13MB PNGs, and the "moving pieces" video now sits in the same frame and caption as the pictures. (#684)
- Collage source labels are now just the site's icon and address.
- Headings in a collage now wrap onto more lines when you pull them narrower from a side (only corners scale them), and pale headings no longer bring their dark backing onto the collage.
- Exporting your data now works no matter how much history you have, so you can move it to a new browser.
