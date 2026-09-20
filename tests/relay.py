#!/usr/bin/env python3
"""M353: the house carries a call a web page is refused. Runs the tavern's own server with a stand-in provider behind
it: what goes up, what comes back, that it streams as it comes, and what it refuses to carry.
Run: COZY_RELAY_TEST=1 python3 tests/relay.py"""
import base64, http.server, json, os, socket, socketserver, subprocess, sys, threading, time, urllib.error, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ok = 0
bad = []

def check(name, got, want):
    global ok
    if got == want:
        ok += 1
        print('  ok —', name)
    else:
        bad.append(name + ': got ' + repr(got) + ', wanted ' + repr(want))
        print('  FAIL —', name, '\n      got', repr(got), '\n      wanted', repr(want))

def free_port():
    s = socket.socket()
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
    s.close()
    return port

seen = {}

class Provider(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_GET(self):
        seen['get'] = {'path': self.path, 'auth': self.headers.get('Authorization')}
        body = json.dumps({'data': [{'id': 'hemmingway-27b'}]}).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b''
        seen['post'] = {'path': self.path, 'auth': self.headers.get('Authorization'), 'body': json.loads(raw or b'{}')}
        if seen['post']['body'].get('model') == 'refused':
            said = json.dumps({'error': {'message': "Invalid value: 'medium'. Supported values are: 'low', 'high', and 'max'."}}).encode()
            self.send_response(400); self.send_header('Content-Type', 'application/json'); self.send_header('Content-Length', str(len(said))); self.end_headers(); self.wfile.write(said); return
        self.send_response(200); self.send_header('Content-Type', 'text/event-stream'); self.end_headers()
        for i in range(3):
            self.wfile.write(('data: {"choices":[{"delta":{"content":"part' + str(i) + '"}}]}\n\n').encode())
            self.wfile.flush()
            seen.setdefault('sent_at', []).append(time.time())
            time.sleep(0.25)
        self.wfile.write(b'data: [DONE]\n\n')
        self.wfile.flush()

class Threaded(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True

def main():
    pport = free_port()
    prov = Threaded(('127.0.0.1', pport), Provider)
    threading.Thread(target=prov.serve_forever, daemon=True).start()
    tport = free_port()
    env = dict(os.environ, COZY_RELAY_TEST='1', PORT=str(tport))
    house = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py')], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = 'http://127.0.0.1:' + str(tport)
    try:
        for _ in range(100):
            try:
                urllib.request.urlopen(base + '/api/relay', timeout=1).read(); break
            except Exception:
                time.sleep(0.1)
        said = json.loads(urllib.request.urlopen(base + '/api/relay', timeout=5).read())
        check('the house says it can carry', said, {'relay': True})

        def relay(url, body=None, method='POST', headers=None, timeout=20):
            head = {'Content-Type': 'application/json', 'X-Relay-Url': url, 'X-Relay-Method': method,
                    'X-Relay-Headers': base64.b64encode(json.dumps(headers or {}).encode()).decode()}
            data = json.dumps(body).encode() if body is not None else None
            return urllib.request.urlopen(urllib.request.Request(base + '/api/relay', data=data or b'', headers=head, method='POST'), timeout=timeout)

        up = 'http://127.0.0.1:' + str(pport)
        res = relay(up + '/v1/chat/completions', {'model': 'hemmingway-27b', 'messages': [{'role': 'user', 'content': 'Hello'}]}, headers={'Authorization': 'Bearer secret-key'})
        chunks = []
        at = []
        while True:
            piece = res.read1(4096) if hasattr(res, 'read1') else res.read(1)
            if not piece: break
            chunks.append(piece); at.append(time.time())
        whole = b''.join(chunks)
        check('the provider got the post, at its own path', seen['post']['path'], '/v1/chat/completions')
        check('with the key, as given', seen['post']['auth'], 'Bearer secret-key')
        check('and the body, word for word', seen['post']['body'], {'model': 'hemmingway-27b', 'messages': [{'role': 'user', 'content': 'Hello'}]})
        check('the answer came back whole', whole.count(b'data:'), 4)
        check('and in pieces as they came, not all at the end', len(at) >= 3 and (at[-1] - at[0]) > 0.3, True)
        res2 = relay(up + '/v1/models', method='GET', headers={'Authorization': 'Bearer secret-key'})
        check('a listing is carried too', json.loads(res2.read())['data'][0]['id'], 'hemmingway-27b')
        try:
            relay(up + '/v1/chat/completions', {'model': 'refused'})
            check('the provider’s own no is passed through', 'no error', '400')
        except urllib.error.HTTPError as err:
            check('the provider’s own no is passed through, with its number', err.code, 400)
            check('and its own words', json.loads(err.read())['error']['message'].startswith('Invalid value'), True)
        # the guards are the plain house's, not the test house's
        strict_port = free_port()
        strict = subprocess.Popen([sys.executable, os.path.join(ROOT, 'serve.py')], cwd=ROOT,
                                  env=dict(os.environ, PORT=str(strict_port), COZY_RELAY_TEST=''),
                                  stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        strict_base = 'http://127.0.0.1:' + str(strict_port)
        try:
            for _ in range(100):
                try:
                    urllib.request.urlopen(strict_base + '/api/relay', timeout=1).read(); break
                except Exception:
                    time.sleep(0.1)
            def ask(url):
                head = {'Content-Type': 'application/json', 'X-Relay-Url': url, 'X-Relay-Method': 'POST',
                        'X-Relay-Headers': base64.b64encode(b'{}').decode()}
                try:
                    r = urllib.request.urlopen(urllib.request.Request(strict_base + '/api/relay', data=b'{}', headers=head, method='POST'), timeout=10)
                    return r.status, r.read()
                except urllib.error.HTTPError as err:
                    return err.code, err.read()
            code, said = ask(up + '/v1/chat/completions')  # plain http, out in the world
            check('a plain http address is not carried', (code, json.loads(said)['error']['message']), (400, 'the relay carries https only'))
            code, said = ask('https://127.0.0.1:9/x')
            check('nor a machine on his own network', (code, json.loads(said)['error']['message']), (400, 'the relay does not carry to your own network'))
        finally:
            strict.terminate()
    finally:
        house.terminate()
        prov.shutdown()
    print('\n' + str(ok) + ' passed, ' + str(len(bad)) + ' failed')
    sys.exit(1 if bad else 0)

main()
