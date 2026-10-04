#!/usr/bin/env python3
"""Render and exercise the production favorites panel using an installed PyCharm SDK.

This offscreen fixture supplements real IDE checks; it does not certify native
popup focus, the system clipboard, live navigation, or a full IDE restart.
"""
import json
import os
from pathlib import Path
import subprocess
import zipfile

project = Path(__file__).resolve().parents[1]
ide = Path(os.environ.get('PYCHARM_HOME', '/Applications/PyCharm.app')) / 'Contents'
runtime = ide / 'jbr/Contents/Home/bin'
build = project / 'build/local'
fixture = project / '../qa/fixtures/FavoritesUiFixture.java'
classes = project / 'build/favorites-ui/classes'
output = project / 'build/favorites-ui/screenshots'
classes.mkdir(parents=True, exist_ok=True)
classpath = os.pathsep.join([str(build / 'classes'), str(ide / 'lib/*'), str(classes)])
subprocess.run([str(runtime / 'javac'), '-encoding', 'UTF-8', '-cp', classpath, '-d', str(classes), str(fixture)], check=True)
info = json.loads((ide / 'Resources/product-info.json').read_text())
args = [arg for arg in info['launch'][0]['additionalJvmArguments']
        if arg.startswith('--add-opens=') or arg.startswith('--enable-native-access=')]
def merge(base, update):
    for key, value in update.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        else:
            base[key] = value
    return base

for scheme in ['light', 'dark']:
    with zipfile.ZipFile(ide / 'lib/intellij.platform.ide.impl.jar') as archive:
        theme = json.loads(archive.read(f'themes/expUI/expUI_{scheme}.theme.json'))
        if scheme == 'light':
            parent = json.loads(archive.read('themes/intellijlaf.theme.json'))
            theme['colors'] = merge(parent['colors'], theme['colors'])
            theme['ui'] = merge(parent['ui'], theme['ui'])
    theme_path = classes.parent / f'{scheme}.theme.json'
    theme_path.write_text(json.dumps(theme))
    subprocess.run([str(runtime / 'java'), *args,
                    '-Djna.boot.library.path=' + str(ide / 'lib/jna/aarch64'),
                    '-Djava.awt.headless=true', '-ea', '-cp', classpath,
                    'studio.lexiao.linuxdo.FavoritesUiFixture', str(output), scheme, str(theme_path)], check=True, timeout=40)
print(output)
