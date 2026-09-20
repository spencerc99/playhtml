# Installation reference: September 8–9, 2026

These settings record the installation configuration, not a recommendation for every Pi. Screens 2, 8, 9, and 13 were read live on September 8; Screen 6 was reconstructed from the last verified setup after it became unreachable. No passwords are included.

| Screen | User | Page query | Display command | Delay | Graphics |
| --- | --- | --- | --- | --- | --- |
| 2 | rpi32 | `screen=follower-a` | None; native 1280×1024 | 0 | GLES2 flags |
| 6 | rpi30 | `screen=follower-b` | `wlr-randr --output HDMI-A-1 --mode 1280x720@60.000000Hz` | 0 | GLES2 flags |
| 8 | rpi36 | `screen=follower-c` | `wlr-randr --output HDMI-A-1 --custom-mode 1280x720@60Hz` | 30 | GLES2 flags |
| 9 | rpi40 | `screen=touches&scale=2` | `wlr-randr --output HDMI-A-1 --mode 1920x1200@59.950001Hz` | 30 | GLES2 flags |
| 13 | rpi39 | `screen=clicks` | None | 30 | Software |

Followers used `https://wewere.online/installation/live/?clean=2&screen=follower-a` (or `follower-b` / `follower-c`). Screen 9 used `https://wewere.online/touches/?clean=2&screen=touches&scale=2`. Screen 13 used the evaluation URL `https://7e27e91a.we-were-online-website.pages.dev/installation/live/?clean=2&screen=clicks`; its continued availability is not guaranteed.

The original desktop files used `Type=Application`, `Name=Kiosk`, and `X-GNOME-Autostart-enabled=true`. Screen 2 launched Chromium directly. Screen 6 prefixed the command with `/home/rpi30/.local/bin/kiosk-display`; 8, 9, and 13 used `/home/USER/.local/bin/kiosk-start`. The helpers slept for the delay above, ran the display command if present, and ended with `exec "$@"`.

All historical Chromium commands included the following flags, with `USER` replaced by the table's username:

```text
--ozone-platform=wayland
--enable-logging
--log-file=/home/USER/.cache/kiosk-chromium.log
--password-store=basic
--no-sandbox
--num-raster-threads=4
--enable-async-image-decoding
--enable-low-end-device-mode
--noerrdialogs
--disable-infobars
--kiosk
--hide-scrollbars
--check-for-update-interval=31536000
```

Screens 2, 6, 8, and 9 additionally used:

```text
--disable-features=FallbackToSWIfGLES3NotSupported
--ignore-gpu-blocklist
--enable-gpu-rasterization
--enable-zero-copy
```

Screen 13 instead used:

```text
--disable-gpu
--disable-gpu-rasterization
```

The shared cursor script in this directory preserves the `swayidle` / `wtype` command installed on all five Pis. Its desktop entry used the absolute `/home/USER/.local/bin/kiosk-cursor` path. The labwc shortcut was:

```xml
<keybind key="A-W-h">
  <action name="HideCursor" />
</keybind>
```

Screens 2 and 8 had intermittent stalls that recovered after reload; their root cause was not confirmed. Screen 6 became unreachable on the local network; scans did not establish whether it lost Wi-Fi or had another failure. Screen 9 remained blank on September 9 after both reload and restart. Do not use those incidents as evidence of a resolved graphics or network fix.
