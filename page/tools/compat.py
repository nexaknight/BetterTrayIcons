"""Writes compat.json, which GNOME Shell versions each release supported.

Walks the Release Please tags and reads metadata.json at every tag, so the
page's compatibility dialog never needs a hand-kept list.

Run as python3 compat.py <repo root> <output file>.
"""

import json
import subprocess
import sys
from pathlib import Path


def git(root, *args):
    result = subprocess.run(['git', '-C', str(root), *args], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else None


def version_key(version):
    return tuple(int(part) for part in version.split('.'))


def read_releases(root):
    tags = git(root, 'tag', '-l', 'v*', '--sort=-v:refname')
    releases = []
    for tag in (tags or '').splitlines():
        data = json.loads(git(root, 'show', f'{tag}:metadata.json'))
        releases.append({
            'version': data['version-name'],
            'date': git(root, 'log', '-1', '--format=%cs', tag),
            'shell': data['shell-version'],
        })
    return releases


def main():
    root, output = Path(sys.argv[1]), Path(sys.argv[2])
    current = json.loads((root / 'metadata.json').read_text(encoding='utf-8'))
    current_version = current['version-name']
    releases = read_releases(root)
    if not releases:
        print('Warning: no release tags found, a shallow clone? compat.json lists the working tree only', file=sys.stderr)

    # The working tree is ahead of every tag until Release Please tags it.
    # Without tags there is nothing to compare, so it stands in as a release.
    working_tree = {'version': current_version, 'date': None, 'shell': current['shell-version']}
    if not releases:
        releases.append(working_tree)
    elif version_key(current_version) > version_key(releases[0]['version']):
        releases.insert(0, {**working_tree, 'unreleased': True})

    gnome = {}
    for release in releases:
        entry = {key: value for key, value in release.items() if key != 'shell'}
        for shell in release['shell']:
            gnome.setdefault(shell, []).append(entry)
    ordered = dict(sorted(gnome.items(), key=lambda item: version_key(item[0]), reverse=True))
    payload = {'gnome': ordered, 'current': {'version': current_version, 'shell': current['shell-version']}}
    output.write_text(json.dumps(payload, indent=1) + '\n', encoding='utf-8')
    print(f'compat.json: {len(releases)} releases, {len(ordered)} GNOME versions')


if __name__ == '__main__':
    main()
