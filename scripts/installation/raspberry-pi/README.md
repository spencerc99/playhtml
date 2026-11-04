# Raspberry Pi kiosk startup

Install Chromium kiosk startup and physical-pointer hiding for a Raspberry Pi running a labwc Wayland desktop. The installer writes per-user files and starts them at the next desktop login; desktop autologin must already be configured.

## Install

Copy this directory to the Pi. Install dependencies, then run the installer as the kiosk user **without sudo**:

```sh
sudo apt-get install chromium labwc wlr-randr swayidle wtype python3
python3 install.py --username "$(id -un)" \
  --url 'https://wewere.online/touches/?clean=2&screen=touches&scale=2'
```

This keeps the current display mode, waits 30 seconds, and lets Chromium choose its graphics backend. Log out and back into the labwc desktop to activate it. It does not restart an existing browser, install a system service, or configure Wi-Fi.

To select a resolution, first run `wlr-randr` in that desktop session and choose a supported mode:

```sh
python3 install.py --username "$(id -un)" \
  --url 'https://wewere.online/installation/live/?clean=2&screen=follower-b' \
  --output HDMI-A-1 --mode 1280x720@60.000000Hz --delay 0
```

`--custom-mode` requests an unadvertised mode. Only use it after testing the physical monitor. A failed display-mode command stops the launcher instead of silently launching at another resolution.

## Choose graphics settings

| Option | Behavior |
| --- | --- |
| `--graphics auto` | Chromium chooses its backend; default for future installs. |
| `--graphics gles2` | Uses the GLES2 fallback flag tested on Chromium 149 with the installation's Pi 3B+ VC4 GPUs, plus explicit GPU rasterization and zero-copy flags. |
| `--graphics software` | Disables GPU rendering and GPU rasterization. Used on Screen 13 after graphics-memory exhaustion. |

The `FallbackToSWIfGLES3NotSupported` flag is Chromium-version-dependent. Do not assume it works on another release. Check `chrome://gpu` during setup and verify the visualization on the physical display after each graphics change. An `EGL_BAD_ATTRIBUTE` message alone does not establish failure: it appeared on working and failing installation screens.

The historical installations also used `--no-sandbox`. This installer only adds that flag when explicitly passed; it disables Chromium's process sandbox. The other retained historical tuning flags are recorded in [reference-configurations.md](reference-configurations.md), rather than treated as universal performance improvements.

## Files and backups

- `~/.config/autostart/kiosk.desktop` launches `~/.local/bin/kiosk-start.py`.
- `~/.config/kiosk/config.json` stores the URL, delay, display mode, and graphics choice.
- `~/.config/autostart/kiosk-cursor.desktop` launches `~/.local/bin/kiosk-cursor`.
- `~/.config/labwc/rc.xml` gets an `A-W-h` binding for `HideCursor`.
- `~/.cache/kiosk-chromium.log` and `~/.cache/kiosk-launch.log` hold browser output.

The installer backs up changed existing files beside them with a `.backup-TIMESTAMP` suffix. Repeating an identical install does not create another backup. It preserves labwc settings and XML comments inside the configuration root, though XML formatting may change. With no user configuration, it starts from `/etc/xdg/labwc/rc.xml`. A conflicting `A-W-h` shortcut stops installation before files are written.

The pointer disappears after one second of inactivity. This does not hide cursors drawn by the visualization. Earlier shell helpers named `kiosk-start` or `kiosk-display` are left on disk; the installed desktop entry points to `kiosk-start.py`.

To disable startup, remove the two `kiosk*.desktop` launchers installed above. Restore individual timestamped backups if returning to a previous configuration; preserve any later labwc edits. Disabling startup does not close an already-running browser.

## Verify the installation

After desktop login, confirm the correct URL, aspect ratio, physical-pointer hiding, and animation over several minutes. Check logs if the page stays blank:

```sh
tail -n 60 ~/.cache/kiosk-chromium.log
tail -n 60 ~/.cache/kiosk-launch.log
wlr-randr
vcgencmd measure_temp
vcgencmd get_throttled
```

There is no periodic refresh or crash watchdog. Screen 9's blank touches page on September 9, 2026 remained unresolved after a reload and browser restart, despite HTTP 200 and available memory. These scripts preserve installation knowledge; they do not fix that page failure.

Local filesystem tests, requiring only Python:

```sh
python3 -B -m unittest discover -s scripts/installation/raspberry-pi -p 'test_*.py'
```

These tests cover installation, backups, and configuration preservation. They do not validate Chromium graphics or a physical display.
