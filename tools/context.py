#!/usr/bin/env python3
"""Bounded milestone lookup; never dump the full history into an assistant session."""
import argparse
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('term', help='literal milestone, module path or topic')
parser.add_argument('--list', action='store_true', help='matching section titles only')
parser.add_argument('--limit', type=int, default=12000, help='output characters, hard maximum 24000')
args = parser.parse_args()
source = (Path(__file__).resolve().parents[1] / 'HISTORY.md').read_text()
sections = re.split(r'(?m)(?=^#{1,3} .*M\d+)', source)
matches = [s for s in sections if args.term.casefold() in s.casefold()]
budget = max(500, min(24000, args.limit))
print(str(len(matches)) + ' matching sections; newest first, bounded output. Full record: HISTORY.md')
for section in reversed(matches):
    text = section.splitlines()[0] if args.list else section.strip()
    excerpt = text[:budget]
    print('\n' + excerpt)
    budget -= len(excerpt) + 2
    if budget <= 0:
        print('\n[Output capped. Narrow the term or read a specific section.]')
        break
