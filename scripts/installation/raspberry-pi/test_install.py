# ABOUTME: Exercises kiosk installation against real temporary files.
# ABOUTME: Checks labwc preservation, backups, repeat installs, and shortcut conflicts.
import importlib.util
from pathlib import Path
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallationTests(unittest.TestCase):
    def test_install_and_repeat_preserve_settings(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory) / 'pi'
            system = Path(directory) / 'system.xml'
            system.write_text('<labwc_config><!-- Keep me --><keyboard><keybind key="W-r"><action name="Execute" command="terminal" /></keybind></keyboard><theme><name>Example</name></theme></labwc_config>')
            config = {'url': 'https://wewere.online/touches/?clean=2&scale=2',
                      'mode': None, 'output': None, 'custom_mode': False,
                      'delay': 30, 'graphics': 'auto', 'no_sandbox': False}
            installer.install(home, config, system)
            rc = home / '.config/labwc/rc.xml'
            text = rc.read_text()
            root = ET.fromstring(text)
            self.assertIn('Keep me', text)
            self.assertEqual(root.findtext('theme/name'), 'Example')
            self.assertEqual(len(root.findall('keyboard/keybind')), 2)
            self.assertEqual(root.find("keyboard/keybind[@key='W-r']/action").get('command'), 'terminal')
            self.assertTrue((home / '.local/bin/kiosk-cursor').stat().st_mode & 0o111)
            installer.install(home, config, system)
            self.assertEqual(rc.read_text(), text)
            self.assertEqual(list(home.rglob('*.backup-*')), [])
            config['delay'] = 0
            previous = (home / '.config/kiosk/config.json').read_text()
            installer.install(home, config, system)
            backups = list(home.rglob('*.backup-*'))
            self.assertEqual(len(backups), 1)
            self.assertEqual(backups[0].read_text(), previous)

    def test_conflict_leaves_home_untouched(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            rc = home / '.config/labwc/rc.xml'
            rc.parent.mkdir(parents=True)
            text = '<labwc_config><keyboard><keybind key="A-W-h"><action name="Execute" command="other" /></keybind></keyboard></labwc_config>'
            rc.write_text(text)
            with self.assertRaisesRegex(ValueError, 'already assigned'):
                installer.install(home, {})
            self.assertEqual(rc.read_text(), text)
            self.assertFalse((home / '.config/autostart').exists())

    def test_missing_configuration_does_not_create_files(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            with self.assertRaisesRegex(ValueError, 'No user or system'):
                installer.install(home, {}, home / 'missing.xml')
            self.assertEqual(list(home.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
