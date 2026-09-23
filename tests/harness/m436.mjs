/* M436: a character card picture is read whether it carries its character in the V2 "chara" chunk, the V3 "ccv3" chunk,
 * or both (the V3 first); a damaged one says so. Builds real PNG bytes and runs the real reader. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { parseCard } from '../../js/import/cards.js';

const table = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const v = new DataView(out.buffer);
  v.setUint32(0, data.length);
  out.set([...type].map((ch) => ch.charCodeAt(0)), 4);
  out.set(data, 8);
  v.setUint32(8 + data.length, crc(out.subarray(4, 8 + data.length)));
  return out;
}
const text = (keyword, obj) => chunk('tEXt', new Uint8Array([...Buffer.from(keyword + '\0' + Buffer.from(JSON.stringify(obj)).toString('base64'), 'latin1')]));
function png(...chunks) {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = chunk('IHDR', new Uint8Array(13));
  const parts = [new Uint8Array(sig), ihdr, ...chunks, chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
const v2 = { spec: 'chara_card_v2', data: { name: 'Rias (v2)', description: 'from chara' } };
const v3 = { spec: 'chara_card_v3', data: { name: 'Rias (v3)', description: 'from ccv3' } };

test('M436-1 A CARD PICTURE IS READ FROM EITHER CHUNK: V2 "chara", V3 "ccv3" alone, both (the V3 first); a damaged one says so', async () => {
  eq((await parseCard(png(text('chara', v2)))).name, 'Rias (v2)', 'a V2 picture');
  eq((await parseCard(png(text('ccv3', v3)))).name, 'Rias (v3)', 'a V3 picture that carries only ccv3');
  eq((await parseCard(png(text('chara', v2), text('ccv3', v3)))).name, 'Rias (v3)', 'both: the fuller V3');
  const broken = png(text('ccv3', v3));
  broken[broken.length - 20] ^= 0xff; /* a byte inside the ccv3 chunk's words */
  let said = '';
  try { await parseCard(broken); } catch (err) { said = err.message; }
  assert(/damaged/.test(said), 'a damaged picture says so: ' + said);
});
