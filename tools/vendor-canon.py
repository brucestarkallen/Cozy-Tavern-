#!/usr/bin/env python3
"""M346: Canon verification in Cozy Tavern IS the writer's own extension (Canon Grounding,
github.com/brucestarkallen/Sillytavern-Canon-Verification-), not a rewrite of it: its index.js is
copied here with exactly three mechanical changes, each asserted to match once —
  1. its two SillyTavern imports point at js/canon/host.js (Cozy's stand-in for ST's surface);
  2. jQuery / $ / toastr come from host.js too (the boot waits for Cozy; the ST settings panel is inert);
  3. the boot no longer builds ST's settings panel (Cozy's Settings has its own section).
Every line of the pipeline — parser, evidence, auditor, lookup, caches, budget, absence, composer — is
the extension's, so its own gates (test/proof.js, test/sim.mjs) prove the code Cozy runs.
Run: python3 tools/vendor-canon.py <path to the extension's index.js> [commit]"""
import sys, re, pathlib
src_path = pathlib.Path(sys.argv[1])
commit = sys.argv[2] if len(sys.argv) > 2 else 'unknown'
s = src_path.read_text()
ver = re.search(r'const CG_VERSION = "([^"]+)"', s)
assert ver, 'no CG_VERSION'
def rep(old, new):
    global s
    n = s.count(old)
    assert n == 1, (n, old[:70])
    s = s.replace(old, new)
rep('import { extension_settings, getContext } from "../../../extensions.js";',
    'import { extension_settings, getContext, $, jQuery, toastr } from "./host.js";')
rep('import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "../../../../script.js";',
    'import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "./host.js";')
rep('jQuery(async () => {\n    settings();\n    await addSettingsUI();\n',
    'jQuery(async () => {\n    settings();\n')
head = ('/* Cozy Tavern — js/canon/grounding.js\n'
        ' * VENDORED: Canon Grounding v' + ver.group(1) + ' (github.com/brucestarkallen/Sillytavern-Canon-Verification- @ ' + commit + ')\n'
        ' * by tools/vendor-canon.py. Do not edit here — change the extension and vendor it again. */\n')
out = pathlib.Path(__file__).resolve().parent.parent / 'js' / 'canon' / 'grounding.js'
out.write_text(head + s)
print('vendored v' + ver.group(1), len(s), 'chars ->', out)
