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
 * Pure. */
import { renderStateFacts, BLIND_HEAD } from '../engine/state.js';
import { toTeller } from './voice.js';

export const ANCHOR_MAX_BLIND = 3;
export function sceneAnchor(state, { scenePages = [], voice = null } = {}) {
  if (!state || typeof state !== 'object') return '';
  let facts = '';
  try { facts = renderStateFacts(state, { scenePages }) || ''; } catch (err) { return ''; }
  const lines = facts.split('\n').map((l) => l.trim()).filter(Boolean);
  const pick = (head) => lines.find((l) => l.startsWith(head)) || '';
  const hour = pick('The hour: '); const ground = pick('The ground: '); const here = pick('Here now: ');
  if (!hour && !ground && !here) return '';
  const blind = lines.map((l) => (l.startsWith(BLIND_HEAD) ? l.slice(BLIND_HEAD.length) : l)).filter((l) => / has not been shown learning: /.test(l)).slice(0, ANCHOR_MAX_BLIND);
  const body = ['right now, so it is in front of you —', hour, ground, here, ...blind].filter(Boolean).join(' ');
  const named = voice && voice.teller ? toTeller(body, voice) : body[0].toUpperCase() + body.slice(1);
  return named;
}
