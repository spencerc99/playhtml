#!/usr/bin/env python3
# ABOUTME: Installs per-user Wayland kiosk startup files without starting Chromium.
# ABOUTME: Backs up changed files and merges the cursor shortcut into labwc settings.
import argparse
from datetime import datetime
import json
from pathlib import Path
import pwd
import re
import shutil
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit


def cursor_config(data):
    parser = ET.XMLParser(target=ET.TreeBuilder(insert_comments=True))
    root = ET.fromstring(data, parser=parser)
    if root.tag != 'labwc_config':
        raise ValueError('Expected a labwc_config root element')
    for binding in root.findall('./keyboard/keybind'):
        if binding.get('key') == 'A-W-h':
            actions = list(binding)
            if len(actions) == 1 and actions[0].tag == 'action' and actions[0].attrib == {'name': 'HideCursor'}:
                return data
            raise ValueError('A-W-h is already assigned; resolve the shortcut conflict before installing')
    keyboard = root.find('keyboard')
    if keyboard is None:
        keyboard = ET.SubElement(root, 'keyboard')
    binding = ET.SubElement(keyboard, 'keybind', key='A-W-h')
    ET.SubElement(binding, 'action', name='HideCursor')
    return ET.tostring(root, encoding='unicode') + '\n'


def desktop(name, executable):
    # Desktop Entry escaping differs from shell quoting; percent introduces field codes.
    escaped = str(executable).replace('\\', '\\\\\\\\').replace('"', '\\\\"').replace('`', '\\\\`').replace('$', '\\\\$').replace('%', '%%')
    return f'[Desktop Entry]\nType=Application\nName={name}\nExec="{escaped}"\nX-GNOME-Autostart-enabled=true\n'


def install(home, config, system_rc=Path('/etc/xdg/labwc/rc.xml')):
    source = Path(__file__).parent
    rc = home / '.config/labwc/rc.xml'
    if rc.exists():
        data = rc.read_text()
    elif system_rc.exists():
        data = system_rc.read_text()
    else:
        raise ValueError('No user or system labwc rc.xml found; configure labwc before installing')
    files = {
        rc: cursor_config(data),
        home / '.config/kiosk/config.json': json.dumps(config, indent=2) + '\n',
        home / '.local/bin/kiosk-start.py': (source / 'kiosk-start.py').read_text(),
        home / '.local/bin/kiosk-cursor': (source / 'kiosk-cursor').read_text(),
        home / '.config/autostart/kiosk.desktop': desktop('Kiosk', home / '.local/bin/kiosk-start.py'),
        home / '.config/autostart/kiosk-cursor.desktop': desktop('Kiosk cursor', home / '.local/bin/kiosk-cursor'),
    }
    stamp = datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    for path, contents in files.items():
        if path.exists() and path.read_text() == contents:
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if path.exists():
            shutil.copy2(path, path.with_name(path.name + '.backup-' + stamp))
        path.write_text(contents)
    for name in ('kiosk-start.py', 'kiosk-cursor'):
        (home / '.local/bin' / name).chmod(0o755)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--username', required=True, help='Must be the current, non-root user')
    parser.add_argument('--url', required=True)
    parser.add_argument('--delay', type=int, default=30)
    parser.add_argument('--mode', help='A mode listed by wlr-randr, such as 1280x720@60Hz')
    parser.add_argument('--output', help='Required with --mode, such as HDMI-A-1')
    parser.add_argument('--custom-mode', action='store_true')
    parser.add_argument('--graphics', choices=['auto', 'gles2', 'software'], default='auto')
    parser.add_argument('--no-sandbox', action='store_true', help='Explicitly disable Chromium sandboxing')
    args = parser.parse_args()
    import os
    user = pwd.getpwuid(os.getuid())
    if user.pw_uid == 0 or args.username != user.pw_name:
        parser.error('Run as the named kiosk user, without sudo')
    url = urlsplit(args.url)
    if url.scheme not in ('http', 'https') or not url.hostname or any(ord(c) < 32 for c in args.url):
        parser.error('--url must be an HTTP(S) URL')
    if args.delay < 0:
        parser.error('--delay must be nonnegative')
    if bool(args.mode) != bool(args.output) or (args.custom_mode and not args.mode):
        parser.error('--mode and --output must be supplied together; --custom-mode requires both')
    if args.mode and not re.fullmatch(r'\d+x\d+@\d+(?:\.\d+)?Hz', args.mode):
        parser.error('--mode must use WIDTHxHEIGHT@RATEHz')
    required = ['chromium', 'swayidle', 'wtype', 'labwc']
    if args.mode:
        required.append('wlr-randr')
    missing = [name for name in required if not shutil.which(name)]
    if missing:
        parser.error('Missing dependencies: ' + ', '.join(missing))
    config = vars(args).copy()
    del config['username']
    try:
        install(Path(user.pw_dir), config)
    except (ValueError, ET.ParseError) as error:
        parser.error(str(error))
    print('Installed. Log out and back into labwc to start the kiosk.')


if __name__ == '__main__':
    main()
