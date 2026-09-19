/* Cozy Tavern — anchor.js
 * M343: THE OLDER-MODEL SWITCH ("derestricted / older model"), part one — the scene, said again at the END.
 *
 * The writer means to tell his stories with an older open model (GLM 4.6, 200k of room) because it never refuses and never
 * preaches — and asked the house to "make this ancient model smarter… good context retention", behind a switch: OFF,
 * everything as it is; ON, whatever helps.
 *
 * What an older model loses first is THE MIDDLE: what stands at the front of a long request (the briefing: the hour, the
 * ground, who is here, who does not know what) is tens of thousands of tokens behind it by the time it writes. The
 * cheapest, surest help is to say the few facts a page cannot get wrong ONCE MORE, last, where such a model looks
 * hardest — in the ledger's own words (no second wording to drift), in the writer's voice (it is a reminder between
 * friends, not an order), and short. Nothing here is an instruction; every line is a fact the briefing already holds.
 * M344: and NOTHING IS EVER REMOVED for it — M343's 64k cap is gone (the writer: "never drop… I asked to make it smart").
 * Pure. */
import { renderStateFacts, BLIND_HEAD } from '../engine/state.js';
import { toTeller } from './voice.js';
import { sceneWordsOf } from '../engine/world.js';

export const ANCHOR_MAX_BLIND = 3;
export function sceneAnchor(state, { scenePages = [], voice = null, recall = '' } = {}) {
  if (!state || typeof state !== 'object') return '';
  let facts = '';
  try { facts = renderStateFacts(state, { scenePages }) || ''; } catch (err) { return ''; }
  const lines = facts.split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = (head) => lines.find((l) => l.startsWith(head)) || '';
  const hour = pick('The hour: '); const ground = pick('The ground: '); const here = pick('Here now: ');
  if (!hour && !ground && !here) return '';
  const blind = lines.map((l) => (l.startsWith(BLIND_HEAD) ? l.slice(BLIND_HEAD.length) : l)).filter((l) => / has not been shown learning: /.test(l)).slice(0, ANCHOR_MAX_BLIND);
  const body = ['right now, so it is in front of you —', hour, ground, here, ...blind, recall].filter(Boolean).join(' ');
  const named = voice && voice.teller ? toTeller(body, voice) : body[0].toUpperCase() + body.slice(1);
  return named;
}


/* M344: WHAT THE STORY SO FAR HOLDS ABOUT THIS — called back to the end, nothing removed.
 * An older model has the whole record in front of it and still loses the line it needs, because that line stands a hundred
 * thousand tokens back. The house can find it: every line of the record is scored against the words of the scene (the
 * last pages and what the writer just wrote) — a word counts for more the fewer lines hold it (so "Jovan" counts for
 * nothing and "fence" for a lot), and the names of the people present are left out of the scoring. The best few are
 * said once more at the end, each under ITS OWN PAGES ("pages 12–17: …") — M336's law: a line called back by its words
 * is never said to bear on the scene, only given with its date, for the teller to weigh. The record itself still rides
 * whole, where it always did. Pure. */
export const RECALL_LINES = 3;
export const RECALL_MAX_CHARS = 280;
export function recallFromRecord(nodes, scenePages, { ignore = [], max = RECALL_LINES } = {}) {
  const list = (Array.isArray(nodes) ? nodes : []).filter((n) => n && typeof n.text === 'string' && n.text.trim() && Array.isArray(n.span) && n.span[0] >= 0 && n.correction !== true);
  if (list.length < 4) return []; /* a short record is all near enough already */
  const scene = sceneWordsOf((Array.isArray(scenePages) ? scenePages : []).filter((t) => typeof t === 'string'));
  if (!scene.size) return [];
  const skip = new Set();
  for (const name of ignore) {
    for (const w of String(name || '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (w) skip.add(w);
    for (const w of sceneWordsOf([String(name || '')])) skip.add(w); /* a name as the scorer itself reads it ("mi-na" is one word to it) */
  }
  const wordsOf = list.map((n) => sceneWordsOf([n.text]));
  const df = new Map();
  for (const ws of wordsOf) for (const w of ws) df.set(w, (df.get(w) || 0) + 1);
  const scored = [];
  list.forEach((n, i) => {
    let score = 0; let hits = 0;
    for (const w of wordsOf[i]) { if (skip.has(w) || !scene.has(w)) continue; hits += 1; score += 1 / (df.get(w) || 1); }
    if (hits >= 2) scored.push({ n, score });
  });
  /* the newest lines of the record stand nearest the pages already; what is called back is what is FAR */
  const far = scored.filter((x) => list.indexOf(x.n) < list.length - 2);
  far.sort((a, b) => b.score - a.score);
  return far.slice(0, max).sort((a, b) => a.n.span[0] - b.n.span[0]).map(({ n }) => {
    const text = n.text.replace(/\s+/g, ' ').trim();
    return { from: n.span[0] + 1, to: n.span[1] + 1, text: text.length > RECALL_MAX_CHARS ? text.slice(0, RECALL_MAX_CHARS - 1).trimEnd() + '…' : text };
  });
}
export function recallLine(recalled) {
  const list = (Array.isArray(recalled) ? recalled : []).filter((r) => r && r.text);
  if (!list.length) return '';
  return 'And from our story so far, each from its own time — ' + list.map((r) => '(pages ' + r.from + (r.to !== r.from ? '–' + r.to : '') + ') ' + r.text).join(' ');
}
