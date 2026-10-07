#!/usr/bin/env python3
# ABOUTME: Launches the Wayland kiosk using the user's saved configuration.
# ABOUTME: Applies an optional display mode and records Chromium output.
import json
import os
from pathlib import Path
import subprocess
import time


def main():
    home = Path.home()
    config = json.loads((home / '.config/kiosk/config.json').read_text())
    time.sleep(config['delay'])
    if config['mode']:
        subprocess.run([
            'wlr-randr', '--output', config['output'],
            '--custom-mode' if config['custom_mode'] else '--mode', config['mode'],
        ], check=True)
    cache = home / '.cache'
    cache.mkdir(exist_ok=True)
    args = ['chromium', '--ozone-platform=wayland', '--enable-logging',
            f'--log-file={cache / "kiosk-chromium.log"}', '--password-store=basic',
            '--noerrdialogs', '--disable-infobars', '--kiosk', '--hide-scrollbars']
    if config['graphics'] == 'gles2':
        args += ['--disable-features=FallbackToSWIfGLES3NotSupported',
                 '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy']
    elif config['graphics'] == 'software':
        args += ['--disable-gpu', '--disable-gpu-rasterization']
    if config['no_sandbox']:
        args.append('--no-sandbox')
    args.append(config['url'])
    with (cache / 'kiosk-launch.log').open('a') as log:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
        os.execvp(args[0], args)


if __name__ == '__main__':
    main()
