#!/usr/bin/env python3
"""Bounded milestone lookup; never dump the full history into an assistant session.

  python3 tools/context.py "M731"                  HISTORY.md, the short record of every milestone
  python3 tools/context.py "M731" --in handoff     the detailed handoffs archived in docs/archive
  python3 tools/context.py "auditor" --in all --list   section titles only, from both
"""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
parser.add_argument('term', help='literal milestone, module path or topic')
parser.add_argument('--list', action='store_true', help='matching section titles only')
parser.add_argument('--in', dest='where', choices=['history', 'handoff', 'all'], default='history',
                    help='history: HISTORY.md (default); handoff: docs/archive/HANDOFF*.md; all: both')
parser.add_argument('--limit', type=int, default=12000, help='output characters, hard maximum 24000')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
files = []
if args.where in ('history', 'all'):
    files.append(root / 'HISTORY.md')
if args.where in ('handoff', 'all'):
    # newest archive first: before-M752-tidy, then before-M689, before-M683
    files += sorted((root / 'docs' / 'archive').glob('HANDOFF*.md'), key=lambda p: p.name, reverse=True)
matches = []
for path in files:
    sections = re.split(r'(?m)(?=^#{1,3} .*M\d+)', path.read_text())
    found = [s for s in sections if args.term.casefold() in s.casefold()]
    # HISTORY.md is appended (oldest first); the handoffs were prepended (newest first)
    if path.name == 'HISTORY.md':
        found.reverse()
    matches += [(path.relative_to(root), s) for s in found]
budget = max(500, min(24000, args.limit))
print(str(len(matches)) + ' matching sections; newest first within each file, bounded output.')
for where, section in matches:
    text = section.splitlines()[0] if args.list else section.strip()
    excerpt = '[' + str(where) + '] ' + text[:budget]
    print('\n' + excerpt)
    budget -= len(excerpt) + 2
    if budget <= 0:
        print('\n[Output capped. Narrow the term or read a specific section.]')
        break
