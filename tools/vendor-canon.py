#!/usr/bin/env python3
"""Copy the shared Canon Grounding source through Cozy's explicit host adapter.

A lock records the last generated copy. Local edits refuse an overwrite. A legacy
copy needs its reviewed SHA256 once; review and merge those edits into the source
first. --check verifies parity without writing. The pipeline has no local fork.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def adapt(source, commit):
    s = source
    ver = re.search(r'const CG_VERSION = "([^"]+)"', s)
    if not ver:
        raise ValueError('The source has no Canon Grounding version.')
    def rep(old, new):
        nonlocal s
        if s.count(old) != 1:
            raise ValueError('The host adapter needs review: ' + old[:80])
        s = s.replace(old, new)
    rep('import { extension_settings, getContext } from "../../../extensions.js";',
        'import { extension_settings, getContext, $, jQuery, toastr } from "./host.js";')
    rep('import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "../../../../script.js";',
        'import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "./host.js";')
    rep('jQuery(async () => {\n    settings();\n    await addSettingsUI();\n',
        'jQuery(async () => {\n    settings();\n')
    # Cozy's own contract: failed lookups never assert absence to its storyteller.
    rep('    reportUnverified: true,', '    reportUnverified: false,')
    rep('const HOST_SILENCES_MISSES = false;', 'const HOST_SILENCES_MISSES = true;')
    head = ('/* Cozy Tavern — js/canon/grounding.js\n'
            ' * VENDORED: Canon Grounding v' + ver.group(1) + ' (github.com/brucestarkallen/Sillytavern-Canon-Verification- @ ' + commit + ')\n'
            ' * by tools/vendor-canon.py. Merge shared changes into the extension before updating this copy. */\n')
    return head + s, ver.group(1)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source', type=pathlib.Path)
    parser.add_argument('commit')
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--reviewed-copy-sha256')
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{7,40}', args.commit):
        raise ValueError('Supply the reviewed source commit, not an unknown provenance.')
    root = pathlib.Path(__file__).resolve().parent.parent
    out = root / 'js/canon/grounding.js'
    lock_path = root / 'tools/vendor-canon.lock.json'
    source = args.source.read_text()
    generated, version = adapt(source, args.commit)
    current = out.read_text() if out.exists() else ''
    if args.check:
        if current != generated:
            raise ValueError('The copy differs from the adapted source; review before updating.')
        print('Canon copy matches the shared source v' + version)
        return
    locked = json.loads(lock_path.read_text()) if lock_path.exists() else None
    reviewed = args.reviewed_copy_sha256 == digest(current)
    if not reviewed and (not locked or locked.get('copy_sha256') != digest(current)):
        raise ValueError('Local canon changes would be overwritten. Merge them into the source first; then supply the reviewed copy SHA256.')
    old_version = locked.get('version') if locked else (re.search(r'const CG_VERSION = "([^"]+)"', current) or [None, '0'])[1]
    if tuple(map(int, version.split('.'))) < tuple(map(int, old_version.split('.'))):
        raise ValueError('The source is older than this copy; refusing a downgrade.')
    out.write_text(generated)
    lock_path.write_text(json.dumps({'version': version, 'source_commit': args.commit, 'source_sha256': digest(source), 'copy_sha256': digest(generated)}, indent=2) + '\n')
    print('Updated Canon Grounding v' + version + ' through the host adapter.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
