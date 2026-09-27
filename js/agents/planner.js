/* Cozy Tavern — agents/planner.js (M510)
 * THE PLANNING HELPER — the small model's other half.
 *
 * A small model writes a good sentence; what it cannot do is hold eighty thousand tokens of a long story in its head and
 * still see who in the room is set against him, who does not know what, which of his laws this scene needs, and what
 * the fight should sound like. So a smarter reader does that part, in the background, right after each page lands (and
 * the moment the Quick switch hands the tale to a small model): it reads EVERYTHING — the whole craft, the ledger, the
 * people's pages, the record, the brief, the latest thirty pages — and writes down what the next page must keep in front
 * of it. The small model then writes from that, a short request instead of the whole story (assemble/stack.js, the
 * small branch). Nothing is lost from the house: every page and the whole record are still read — by the helper.
 *
 * Its answer is data, never trusted as words to send: people must be present in the ledger (the main character never
 * one of them), laws must be the craft's own names, everything is clipped — and the storyteller hears it in the
 * writer's own voice (renderPlan), never a third authority (M495).
 *
 * Only for a tale whose storyteller is a small model (the connection's own tick). Kept per tale, keyed to the page it
 * was made after, the last few kept — so Try again finds the plan for the page before it. */
import { db } from '../store.js';
import { callWorker } from './call.js';
import { parseFirstObject } from './jsonutil.js';
import { lawsOf } from '../assemble/laws.js';
import { renderPlan, renderSounds } from '../assemble/planwords.js'; /* the plan's words — pure, the assembler's too */
export { renderPlan, renderSounds };

export const PLAN_KEY = (storyId) => 'plans:' + storyId;
export const PLAN_KEEP = 4;          /* plans kept per tale — the newest page's and the few before it (Try again) */
export const PLAN_PAGES = 30;        /* pages the helper reads word for word; the record covers the rest */
export const PLAN_MAX_TOKENS = 2000;
const MAX_PEOPLE = 6;
const MAX_UNKNOWN = 6;
const MAX_PRESSING = 4;
const MAX_EARLIER = 3;
const MAX_LAWS = 12;
const MAX_SOUNDS = 6;
const LINE = 280;
const CUE = 60;

/* a page's own fingerprint: which page, which version, which words — an edited page is a new page to plan after */
export function hashText(t) {
  let h = 5381;
  const s = String(t == null ? '' : t);
  for (let i = 0; i < s.length; i += 1) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
export function planKey(msg, text) {
  if (!msg || !msg.id) return 'the opening';
  const version = Number.isFinite(msg.swipeIdx) ? msg.swipeIdx : 0;
  return msg.id + ':' + version + ':' + hashText(text);
}

const clip = (s, n = LINE) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};
const key = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/* the helper's instructions — a worker's, never on the storyteller's wire */
export function plannerAsk({ craft = '', brief = '', castNotes = '', facts = '', people = '', record = '', lore = '', world = '', director = '', pages = [], mc = '', lastSound = '' } = {}) {
  const names = lawsOf(craft).filter((l) => !l.preamble).map((l) => l.section + ' › ' + l.name);
  const system = [
    'You prepare a storyteller for the next page of a long collaborative story. You do not write the page. You read everything the storyteller would need, then write down briefly and concretely what the next page must keep in front of it.',
    'Answer with ONE JSON object and nothing else, in exactly this shape:',
    '{"scene":"","people":[{"name":"","now":"","wants":"","against":""}],"unknown":[{"name":"","fact":""}],"pressing":[""],"earlier":[""],"laws":[""],"intense":false,"loud":true,"loudWhy":"","sounds":[""],"leaveTo":""}',
    'scene — one or two plain sentences: where we are and what is happening this moment.',
    'people — only people present in the scene right now, never the main character. now: what they are doing or feeling this moment. wants: what they want right now. against: what they are set against the main character over, or "" — someone hostile stays hostile; nobody softens because he showed up.',
    'unknown — facts that people present have NOT learned (the ledger names them), so the page never lets them know.',
    'pressing — up to four threads or pressures bearing on this scene now. earlier — up to three facts from earlier in the story that matter here and could be forgotten.',
    'laws — up to twelve laws from the list below that matter for THIS scene, each written exactly as its name after the ›.',
    'intense — true when the scene is, or is about to become, a fight, sex, torture or a raw emotional peak.',
    'loud — for an intense scene: true unless something IN THE SCENE forces them to keep quiet (someone else in hearing range, hiding) — shyness, inexperience or a quiet person is never a reason: they are heard in their own way. loudWhy — what, in a few words.',
    'sounds — for an intense scene, up to six concrete sounds this scene makes, written as they sound and as long as they sound: voiced ones in quotes that stretch or repeat ("Nnh—AHH—AHH—!", "Gkh—hah—hah—"), contact ones in single asterisks, repeated to the rhythm (*slap slap slap*, *CRACK!*). Otherwise [].',
    'leaveTo — where the main character next has a choice to make: the page stops there and leaves it to the writer. Never decide it for him.',
    'Use the names as the story spells them. Invent nothing the story does not support.',
  ].join('\n');
  const user = [
    'The main character — the writer plays him; his words, thoughts and choices are never written for him: ' + (mc || 'the main character'),
    brief ? 'What this story is about, in the writer’s words:\n' + brief : '',
    castNotes ? 'Who is in it, in the writer’s words:\n' + castNotes : '',
    facts ? 'The ledger — the state of things right now:\n' + facts : '',
    people ? 'The people’s pages:\n' + people : '',
    record ? 'The story so far (the older pages, folded into notes):\n' + record : '',
    lore ? 'Lore that the latest pages woke:\n' + lore : '',
    world ? 'What is happening beyond the scene:\n' + world : '',
    director ? 'Where the writer wants this episode to go:\n' + director : '',
    lastSound || '',
    craft ? 'The craft the storyteller writes by:\n' + craft : '',
    names.length ? 'The law names you may choose from:\n' + names.join('\n') : '',
    pages.length ? 'The latest pages, oldest first:\n' + pages.map((p, i) => '--- ' + (i + 1) + ' ---\n' + p).join('\n') : 'The story has not begun yet.',
  ].filter(Boolean).join('\n\n');
  return { system, user };
}

/* The answer, read as data: present people only (never him), the craft's own law names only, everything clipped. */
export function readPlan(raw, { present = [], mc = '', lawNames = [] } = {}) {
  const j = parseFirstObject(typeof raw === 'string' ? raw : '');
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const here = (Array.isArray(present) ? present : []).map((n) => String(n || '')).filter(Boolean);
  const mcKey = key(mc);
  const isHim = (n) => { const k = key(n); return Boolean(mcKey) && (k === mcKey || k.split(' ')[0] === mcKey.split(' ')[0]); };
  const resolve = (name) => {
    const k = key(name);
    if (!k) return '';
    if (!here.length) return clip(name, 60);
    const exact = here.find((h) => key(h) === k);
    if (exact) return exact;
    const byFirst = here.filter((h) => key(h).split(' ')[0] === k.split(' ')[0] || key(h).split(' ').includes(k));
    return byFirst.length === 1 ? byFirst[0] : '';
  };
  const people = [];
  for (const p of Array.isArray(j.people) ? j.people : []) {
    const name = p && resolve(p.name);
    if (!name || isHim(name) || people.some((x) => x.name === name)) continue;
    const entry = { name, now: clip(p.now), wants: clip(p.wants), against: clip(p.against) };
    if (entry.now || entry.wants || entry.against) people.push(entry);
    if (people.length >= MAX_PEOPLE) break;
  }
  const unknown = [];
  for (const u of Array.isArray(j.unknown) ? j.unknown : []) {
    const name = u && resolve(u.name);
    const fact = u && clip(u.fact);
    if (name && fact && !isHim(name)) unknown.push({ name, fact });
    if (unknown.length >= MAX_UNKNOWN) break;
  }
  const list = (v, max, n = LINE) => (Array.isArray(v) ? v : []).map((s) => clip(s, n)).filter(Boolean).slice(0, max);
  const allowed = new Map((Array.isArray(lawNames) ? lawNames : []).map((n) => [key(n), n]));
  const laws = [];
  for (const n of Array.isArray(j.laws) ? j.laws : []) {
    const bare = String(n || '').split('›').pop();
    const found = allowed.get(key(bare));
    if (found && !laws.includes(found)) laws.push(found);
    if (laws.length >= MAX_LAWS) break;
  }
  const plan = {
    scene: clip(j.scene, 400),
    people,
    unknown,
    pressing: list(j.pressing, MAX_PRESSING),
    earlier: list(j.earlier, MAX_EARLIER),
    laws,
    intense: j.intense === true,
    loud: j.loud !== false,
    loudWhy: clip(j.loudWhy, 120),
    sounds: list(j.sounds, MAX_SOUNDS, CUE),
    leaveTo: clip(j.leaveTo, 200),
  };
  if (!plan.scene && !plan.people.length && !plan.laws.length) return null;
  return plan;
}

export async function loadPlans(storyId) {
  const kept = await db.settings.get(PLAN_KEY(storyId));
  return kept && typeof kept === 'object' && !Array.isArray(kept) ? kept : { plans: {}, lastSound: null };
}
export async function loadPlan(storyId, forKey) {
  const kept = await loadPlans(storyId);
  const hit = kept.plans && kept.plans[forKey];
  return hit && hit.plan ? hit.plan : null;
}
/* M510-3: the newest are kept by ORDER, never by clock: two plans kept in the same millisecond tied on `at`, the sort kept
 * the older of them and let the newest go (the full harness caught it; alone it passed). A plan's key is re-set last, and
 * the last PLAN_KEEP stand. */
export async function keepPlan(storyId, forKey, plan) {
  const kept = await loadPlans(storyId);
  const plans = { ...(kept.plans || {}) };
  delete plans[forKey];
  plans[forKey] = { plan, at: Date.now() };
  const newest = Object.entries(plans).slice(-PLAN_KEEP);
  await db.settings.set(PLAN_KEY(storyId), { ...kept, plans: Object.fromEntries(newest) });
}
export async function keepSound(storyId, sound) {
  const kept = await loadPlans(storyId);
  await db.settings.set(PLAN_KEY(storyId), { ...kept, lastSound: sound && typeof sound === 'object' ? sound : null });
}

/* One reading: ask, read the answer as data, keep it under the page it was made after. An answer that cannot be used is
 * asked for once more in the same run with a plain word about why (the world agent's way), then let go — {plan: null}
 * and the raw answer for the workers line. It is never thrown: a throw is the queue's five retries on a two-to-thirty-
 * two-second backoff, a minute of the tale's one channel held for a model that answered badly, while the next send
 * waits on it. A failure to reach the model still throws — that is what the queue's retries are for. */
export const PLAN_TRIES = 2;
export async function runPlanner({ connection, storyId, forKey, ask, present = [], mc = '', lawNames = [], signal, callLLM = callWorker } = {}) {
  if (!connection || !storyId || !ask) return { plan: null, raw: '' };
  let user = ask.user;
  let raw = '';
  for (let tries = 0; tries < PLAN_TRIES; tries += 1) {
    const answer = await callLLM(connection, { system: ask.system, user, maxTokens: PLAN_MAX_TOKENS, signal });
    raw = typeof answer === 'string' ? answer : (answer && typeof answer.text === 'string' ? answer.text : '');
    const plan = readPlan(raw, { present, mc, lawNames });
    if (plan) { await keepPlan(storyId, forKey, plan); return { plan, raw }; }
    user = ask.user + '\n\nYour last answer was not the JSON object asked for. Answer with that one JSON object only — no words before or after it.';
  }
  return { plan: null, raw };
}
