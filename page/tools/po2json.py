#!/usr/bin/env python3
"""Turns every *.po of a folder into a msgid to msgstr JSON map for the project page.

An optional prefix names the outputs apart, page/po becomes page.<lang>.json
next to the extension catalogs from po/.
"""
import ast
import json
import sys
from pathlib import Path


def parse_entries(text):
    entries = []
    entry = {}
    field = None
    for line in text.splitlines() + ['']:
        line = line.strip()
        if not line:
            if entry:
                entries.append(entry)
            entry = {}
            field = None
            continue
        if line.startswith('#,'):
            entry['fuzzy'] = 'fuzzy' in line
            continue
        if line.startswith('#'):
            continue
        if line.startswith('"'):
            entry[field] += ast.literal_eval(line)
            continue
        field, _, value = line.partition(' ')
        entry[field] = ast.literal_eval(value)
    return entries


def translations(po_path):
    result = {}
    for entry in parse_entries(po_path.read_text(encoding='utf-8')):
        msgid = entry.get('msgid', '')
        msgstr = entry.get('msgstr', '')
        # Plural entries carry msgstr[n] instead of msgstr, the page has no plurals
        if not msgid or not msgstr or entry.get('fuzzy') or 'msgid_plural' in entry:
            continue
        result[msgid] = msgstr
    return result


def main():
    po_dir, out_dir = Path(sys.argv[1]), Path(sys.argv[2])
    prefix = sys.argv[3] if len(sys.argv) > 3 else ''
    out_dir.mkdir(parents=True, exist_ok=True)
    for po_path in sorted(po_dir.glob('*.po')):
        target = out_dir / f'{prefix}{po_path.stem}.json'
        target.write_text(json.dumps(translations(po_path), ensure_ascii=False, sort_keys=True), encoding='utf-8')
        print(target)


if __name__ == '__main__':
    main()
