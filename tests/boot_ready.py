#!/usr/bin/env python3
"""A boot that requested a sync reload never exposes a ready app on its departing document.

Drive the real app and sync module with a controlled worker answer. Delay the
browser's reload by recording its request so readiness cannot race navigation.
Both the fast pull and the three-second late pull must stop startup; a boot with
nothing to pull must still finish. COZY_TEST_REPO permits a negative control.
"""
import os, pathlib, subprocess, sys, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

REPO = pathlib.Path(os.environ.get('COZY_TEST_REPO') or pathlib.Path(__file__).resolve().parent.parent)
PORT = os.environ.get('COZY_TEST_PORT', '8170')
BASE = 'http://127.0.0.1:' + PORT + '/'


def main():
    with tempfile.TemporaryDirectory(prefix='cozy-boot-ready-') as data:
        srv = subprocess.Popen([sys.executable, '-B', str(REPO / 'serve.py')], cwd=REPO, env=dict(os.environ, PORT=PORT, COZY_DATA_DIR=data), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            for _ in range(80):
                try:
                    urllib.request.urlopen(BASE + 'api/version', timeout=1).read()
                    break
                except OSError:
                    time.sleep(.25)
            with sync_playwright() as p:
                browser = p.chromium.launch(args=['--no-sandbox'])
                for pulled, delay in [(1, 0), (1, 3200), (0, 0)]:
                    context = browser.new_context(service_workers='block')
                    context.add_init_script('''(() => {
                      const NativeWorker = window.Worker;
                      window.Worker = class extends EventTarget {
                        constructor(url, options) { super(); if (!String(url).endsWith('/js/sync-worker.js')) return new NativeWorker(url, options); }
                        postMessage(msg) { setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { kind: msg.expect, rid: msg.rid, reachable: true, pulled: PULLED, epoch: 'ready-law', ok: true } })), DELAY); }
                        terminate() {}
                      };
                    })();'''.replace('PULLED', str(pulled)).replace('DELAY', str(delay)))
                    def pause_reload(route):
                        source = (REPO / 'js/sync.js').read_text()
                        assert source.count('location.reload();') >= 2
                        route.fulfill(status=200, content_type='text/javascript', body=source.replace('location.reload();', 'window.__reloadWasAsked = true;'))
                    context.route('**/js/sync.js', pause_reload)
                    page = context.new_page()
                    errors = []
                    page.on('pageerror', lambda error: errors.append(str(error)))
                    page.goto(BASE, wait_until='load')
                    if pulled:
                        page.wait_for_function('window.__reloadWasAsked === true', timeout=15000)
                        page.wait_for_timeout(700)
                        assert not page.evaluate('!!window.__cozy'), 'a departing document falsely exposes a ready app (delay %d)' % delay
                        assert not page.evaluate('!!document.documentElement.dataset.version'), 'the departing boot never finishes'
                    else:
                        page.wait_for_function('!!window.__cozy && !!window.__cozy.chat && !!document.documentElement.dataset.version', timeout=15000)
                        assert not page.evaluate('!!window.__reloadWasAsked'), 'an unchanged library opens without a reload'
                    assert not errors, errors
                    print('  ok: boot pull %d, worker delay %d ms' % (pulled, delay))
                    context.close()
                browser.close()
        finally:
            srv.terminate()
            srv.wait(timeout=5)
    print('Boot readiness: 3 scenarios passed.')


if __name__ == '__main__':
    main()
