#!/usr/bin/env python3
"""Exercise the actual vendoring command's refusal and parity doors."""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile

REPO = pathlib.Path(__file__).resolve().parent.parent
SOURCE = '''import { extension_settings, getContext } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types, chat_metadata } from "../../../../script.js";
const CG_VERSION = "0.68.3";
const settings = {
    reportUnverified: true,
};
const HOST_SILENCES_MISSES = false;
jQuery(async () => {
    settings();
    await addSettingsUI();
});
'''

with tempfile.TemporaryDirectory(prefix='cozy-vendor-law-') as temp:
    root = pathlib.Path(temp)
    (root / 'tools').mkdir()
    (root / 'js/canon').mkdir(parents=True)
    shutil.copy2(REPO / 'tools/vendor-canon.py', root / 'tools/vendor-canon.py')
    source = root / 'index.js'
    source.write_text(SOURCE)
    copy = root / 'js/canon/grounding.js'
    copy.write_text('const CG_VERSION = "0.68.2";\n// A local fix that must survive.\n')
    def run(*args):
        return subprocess.run([sys.executable, str(root / 'tools/vendor-canon.py'), str(source), 'abcdef1', *args], capture_output=True, text=True)
    original = copy.read_text()
    assert run().returncode == 1
    assert copy.read_text() == original, 'an unreviewed legacy copy is untouched'
    assert run('--reviewed-copy-sha256', 'wrong').returncode == 1
    assert copy.read_text() == original
    reviewed = hashlib.sha256(original.encode()).hexdigest()
    assert run('--reviewed-copy-sha256', reviewed).returncode == 0
    generated = copy.read_text()
    assert 'HOST_SILENCES_MISSES = true;' in generated
    assert 'reportUnverified: false,' in generated
    assert 'await addSettingsUI();' not in generated
    assert run('--check').returncode == 0
    assert run().returncode == 0, 'an untouched generated copy can be refreshed'
    copy.write_text(generated + '// A new local fix.\n')
    edited = copy.read_text()
    assert run().returncode == 1
    assert copy.read_text() == edited, 'local work is never silently erased'
    assert run('--check').returncode == 1
    assert copy.read_text() == edited, 'checking parity never writes'
    copy.write_text(generated)
    source.write_text(SOURCE.replace('0.68.3', '0.68.2'))
    assert run().returncode == 1
    assert copy.read_text() == generated, 'an older source cannot replace the copy'
print('Canon vendoring: overwrite refusal, reviewed migration, host policy, parity and downgrade checks passed.')
