/* Cozy Tavern — engine/names.js
 * M396: ONE ANSWER TO "IS THIS THE SAME PERSON?", FOR EVERY BOOK OF THE LEDGER.
 *
 * His Bleach story had Rukia and Suì-Fēng watching the duel in "Who's here" — and in "What's happening elsewhere" at
 * the same time, one in her office, one in her compound. The books compared names four different ways: the seat guard
 * by first and last name, the seat finder by near spelling, the state of things, the drawer and the world agent's own
 * "who is here" by EXACT lower case. "Suì-Fēng" (the name canon verification hands the workers) and "Sui-Feng" or
 * "Soi Fon" (the name on the page) were three people; the world agent was told the one standing in the scene had "NO
 * SEAT — seat them", and seated her elsewhere.
 *
 * One matcher now, used by every book that asks: letters folded (Suì-Fēng = Sui-Feng = sui feng), a first or last name
 * or a name cut short (Rukia = Rukia Kuchiki — never Rukia = Byakuya Kuchiki), and the story's own canon knowledge of
 * who answers to which names (Soi Fon = Suì-Fēng), installed by canon verification when it is on. Pure; no imports. */

/* the story's canon alias groups — [[name, alias, …], …] — or none */
let aliasSource = () => [];
export function setAliasSource(fn) { aliasSource = typeof fn === 'function' ? fn : () => []; }

/* a name with its letters folded: accents off, case off, punctuation to spaces */
export function foldName(name) {
  return String(name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function aliased(a, b) {
  let groups = [];
  try { groups = aliasSource() || []; } catch (err) { groups = []; }
  for (const g of Array.isArray(groups) ? groups : []) {
    const folded = (Array.isArray(g) ? g : []).map(foldName).filter(Boolean);
    if (folded.includes(a) && folded.includes(b)) return true;
  }
  return false;
}

/* Do the story's canon names make `a` and `b` one person (not by letters or first names — by canon alone)? */
export function canonAliasOf(a, b) {
  const fa = foldName(a); const fb = foldName(b);
  return Boolean(fa && fb && fa !== fb && aliased(fa, fb));
}

/* Is `a` the same person as `b`? The same name (folded), a first or last name of the other, one cut short of the
 * other, or two names the story's canon knows as one person. Never a near miss: seating is a hard fact. */
export function samePersonName(a, b) {
  const fa = foldName(a);
  const fb = foldName(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const wa = fa.split(' ');
  const wb = fb.split(' ');
  if (wa.length === 1 && wb.length > 1 && (wb[0] === wa[0] || wb[wb.length - 1] === wa[0])) return true;
  if (wb.length === 1 && wa.length > 1 && (wa[0] === wb[0] || wa[wa.length - 1] === wb[0])) return true;
  if (wa.length >= 2 && wb.length >= 2) {
    /* one cut short: "Vanessa Rey" is Vanessa Reynolds (M257) */
    const [shortOne, longOne] = fa.length <= fb.length ? [fa, fb] : [fb, fa];
    if (longOne.startsWith(shortOne) && longOne.length > shortOne.length) return true;
  }
  return aliased(fa, fb);
}

/* Every name the ledger knows a person by — pages, the scene, the seats. */
function knownNames(state) {
  const s = state && typeof state === 'object' ? state : {};
  return [
    ...Object.keys(s.characters && typeof s.characters === 'object' ? s.characters : {}),
    ...(Array.isArray(s.present) ? s.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)),
    ...Object.keys(s.offscreen && typeof s.offscreen === 'object' ? s.offscreen : {}),
  ].filter((n) => typeof n === 'string' && n.trim());
}

/* Is the person this name means standing in the scene? The same letters decide at once; any other form of the name
 * decides only when it can mean ONE person — two Vanessas in the ledger and a note under "Vanessa" is nobody's to
 * clear when one of them walks in (M320). */
export function isHere(state, name) {
  const present = (Array.isArray(state && state.present) ? state.present : []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
  if (!present.length || !foldName(name)) return false;
  const f = foldName(name);
  if (present.some((p) => foldName(p) === f)) return true;
  const cands = knownNames(state).filter((k) => samePersonName(k, name));
  for (let i = 0; i < cands.length; i += 1) for (let j = i + 1; j < cands.length; j += 1) if (!samePersonName(cands[i], cands[j])) return false;
  return present.some((p) => samePersonName(p, name));
}

/* Is this person among `names` (plain strings or {name})? */
export function amongNames(names, name) {
  return (Array.isArray(names) ? names : []).some((p) => samePersonName(typeof p === 'string' ? p : p && p.name, name));
}
