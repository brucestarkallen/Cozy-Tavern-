/* M619 — the line-by-line audit, part 26: canon verification read whole. Laws RUN its reader on the answers models give. */
import './idb-shim.mjs';
import { test, eq } from './lib.mjs';

test('M619-1 THE WIKI DISCOVERY ANSWER IS READ WHOLE — prose before the JSON, a thought first, or code fences: its franchise, slugs and canon names are kept', async () => {
  const { readDiscovery } = await import('../../js/canon/grounding.js');
  const json = '{"franchise":"Bleach","evidence":"Rukia","slugs":["bleach"],"names":["Rukia Kuchiki","Ichigo Kurosaki"]}';
  for (const [shape, out] of [
    ['bare', json],
    ['fenced', '```json\n' + json + '\n```'],
    ['prose first', 'Here is the JSON:\n' + json],
    ['a thought first', '<think>The text names Rukia and the Gotei 13 — {this is Bleach}.</think>\n' + json],
  ]) {
    const r = readDiscovery(out);
    eq(r && r.franchise, 'Bleach', shape + ': the franchise is read');
    eq(r && r.slugs && r.slugs[0], 'bleach', shape + ': the slugs are read');
    eq(r && r.names && r.names.length, 2, shape + ': the canon names are read');
  }
  eq(readDiscovery('I cannot tell which series this is.'), null, 'no object at all: nothing, as before');
});
