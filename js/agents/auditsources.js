/* M685: source coverage for the ledger audit. A missing person cannot be found
 * by checking only the records that survived. Read original answered pages,
 * keep receipts tied to their exact text, and recover only quoted identities.
 * This is evidence for the auditor, never a second simulation of the present. */
import { callWorker } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { asideAt } from '../commands.js';
import { pageText } from '../assemble/stack.js';
import { djb2 } from '../engine/fingerprint.js';
import { exactNameIn, quotedSource, WRITER_FACTS } from '../engine/evidence.js';
import { findPersonKey, isMc, isGroupName } from '../engine/people.js';
import { roomChars, leashFor } from './lookup.js';

const VERSION = 1;
const MAX_TOKENS = 4000;
const CHUNK = 12000;
const OVERLAP = 1200;

export function auditSources({ brief = '', castNotes = '', messages = [] } = {}) {
  const documents = [];
  const add = (key, label, text) => {
    const value = String(text || '').trim();
    if (!value) return;
    for (let at = 0; at < value.length; at += CHUNK - OVERLAP) {
      const part = value.slice(at, at + CHUNK);
      documents.push({ id: key + ':' + at, label, text: part, mark: VERSION + ':' + value.length + ':' + djb2(part) });
      if (at + CHUNK >= value.length) break;
    }
  };
  add('brief', 'The writer’s brief', brief);
  add('cast', 'The writer’s cast notes', castNotes);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || m.hidden || asideAt(messages, i)) continue;
    add('page:' + m.id, 'Page ' + (i + 1) + (m.role === 'user' ? ', writer' : ', story'), pageText(m));
  }
  return documents;
}

const SYSTEM = withFictionFrame([
  'SOURCE PEOPLE REVIEW. You are the ledger auditor reading ORIGINAL source documents, not a summary.',
  WRITER_FACTS,
  'Find every named person actually established in these documents, including quiet people, absent relatives,',
  'princes, princesses and people introduced only by the writer. The ledger may have lost them completely.',
  'Do not assess their present whereabouts from old pages. Do not invent a biography, surname, title or rank.',
  'Ignore hypothetical characters, wishes, questions about possible people, names used only as comparisons,',
  'and instructions asking for a character to be created later. Keep deceased people as established identities.',
  'For each person copy an exact short passage that establishes their identity and includes their exact name.',
  'Return JSON: {"checked":["each source id actually read"],"people":[{"name":"exact name",',
  '"source":"source id","shown":"exact source quote, at most 1200 characters"}]}.',
  'Read every supplied document. List its id in checked even when it establishes no named people.',
  'The same person needs one informative quote per document, not every mention. Never quote from your instructions.',
].join('\n'));

function parseReview(text, batch) {
  let parsed;
  for (const part of balancedCandidates(String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, ''), 5)) {
    const p = parseLenient(part);
    if (p && Array.isArray(p.people) && Array.isArray(p.checked)) { parsed = p; break; }
  }
  if (!parsed) return {};
  const sources = new Map(batch.map((d) => [d.id, d]));
  const checked = new Set(parsed.checked.filter((id) => sources.has(id)));
  const invalid = new Set(); const people = new Map();
  for (const p of parsed.people) {
    const source = sources.get(p?.source);
    if (!source) { for (const id of checked) invalid.add(id); continue; }
    const name = String(p.name || '').trim();
    const shown = quotedSource(source.text, p.shown);
    if (!name || name.length > 80 || !shown || !exactNameIn(shown, name) || isGroupName(name)) { invalid.add(source.id); continue; }
    if (!people.has(source.id)) people.set(source.id, []);
    if (!people.get(source.id).some((x) => x.name === name)) people.get(source.id).push({ name, shown });
  }
  return Object.fromEntries([...checked].filter((id) => !invalid.has(id)).map((id) => [id, { mark: sources.get(id).mark, people: people.get(id) || [] }]));
}

export async function reviewAuditSources({ connection, documents, previous = {}, mode = 'next', state = {}, signal, stale, renew } = {}) {
  const cache = {};
  for (const d of documents) {
    const old = previous[d.id];
    if (old?.mark === d.mark && Array.isArray(old.people) && old.people.every((p) => quotedSource(d.text, p.shown) && exactNameIn(p.shown, p.name))) cache[d.id] = old;
  }
  const todo = documents.filter((d) => !cache[d.id]);
  const limit = Math.max(1000, Math.min(36000, roomChars(connection, MAX_TOKENS) * 0.6 - SYSTEM.length));
  let calls = 0; let cursor = 0; let failure = '';
  while (cursor < todo.length && (mode === 'all' || calls === 0)) {
    if (stale?.() || signal?.aborted) return null;
    const batch = []; let size = 0;
    while (cursor < todo.length) {
      const d = todo[cursor]; const cost = JSON.stringify(d).length;
      if (size + cost > limit) break;
      batch.push(d); size += cost; cursor++;
    }
    if (!batch.length) { failure = 'the source page does not fit the auditor’s configured context'; break; }
    renew?.(); calls++;
    try {
      const user = 'SOURCE DOCUMENTS\n' + JSON.stringify(batch.map(({ id, label, text }) => ({ id, label, text })));
      renew?.(leashFor(SYSTEM.length + user.length));
      const result = await callWorker(connection, { system: SYSTEM, messages: [{ role: 'user', content: user }], maxTokens: MAX_TOKENS, signal });
      if (stale?.() || signal?.aborted) return null;
      // A truncated answer cannot certify that its final document was read.
      if (result.finishReason === 'length') { failure = 'the source review ran out of answer space'; continue; }
      Object.assign(cache, parseReview(result.text, batch));
    } catch (err) {
      if (signal?.aborted || stale?.()) return null;
      failure = 'the source review did not finish';
      break;
    }
  }
  const unread = documents.filter((d) => !cache[d.id]);
  for (const receipt of Object.values(cache)) receipt.people = receipt.people.map((p) => {
    const ledgerName = sourcePersonKey(state, p.name, p.ledgerName);
    return ledgerName ? { ...p, ledgerName } : p;
  });
  const people = documents.flatMap((d) => (cache[d.id]?.people || []).map((p) => ({ ...p, source: d.id, label: d.label })));
  return { cache, people, calls, total: documents.length, read: documents.length - unread.length,
    pending: unread.length ? [unread.length + ' original source sections still need review' + (failure ? ': ' + failure : '')] : [] };
}

/* Receipts retain their original quotation. Their ledger name follows a real
 * recorded merge, including a merge made before aliases were stored in M687. */
export function sourcePersonKey(state, name, remembered = '') {
  const characters = state?.characters || {};
  const direct = findPersonKey(characters, name);
  if (direct) return direct;
  let renamed = name;
  for (const entry of state.journal || []) {
    const m = entry?.m;
    if (m?.type === 'people.rename' && String(m.from || '').toLowerCase() === String(renamed).toLowerCase()) renamed = m.to;
  }
  if (renamed !== name) return findPersonKey(characters, renamed);
  return remembered ? findPersonKey(characters, remembered) : '';
}

export function missingSourcePeople(state, people = []) {
  const known = { ...(state?.characters || {}) }; const issues = [];
  for (const p of people) {
    if (isMc(state, p.name)) continue;
    const key = sourcePersonKey({ ...state, characters: known }, p.name, p.ledgerName);
    if (key && (String(known[key]?.core || '').trim() || known[key]?.hand?.core)) continue;
    const name = key || p.name;
    // Keep the literal evidence. The auditor may refine this core from the whole
    // story; this restoration neither overwrites a core nor seats anyone here.
    issues.push({ what: name + ' was established in ' + p.label + ' but has no identity on their People page.',
      fix: 'Restore their identity from the original source.', pages: false,
      mutations: [{ type: 'people.set', name, field: 'core', text: p.shown, evidence: p.shown, sourceRecovery: true, cause: 'identity restored from ' + p.label }] });
    known[name] = { ...(known[name] || {}), core: p.shown };
  }
  return issues;
}

export function missingLedgerPeople(state, castNames = []) {
  const names = new Set([
    ...(state?.present || []).map((p) => p.name), ...Object.keys(state?.offscreen || {}),
    ...Object.keys(state?.relationships || {}), ...Object.keys(state?.knowledge || {}),
    ...Object.keys(state?.canon || {}), ...Object.keys(state?.sheet?.actors || {}), ...castNames,
  ]);
  return [...names].filter((name) => {
    if (!name || isMc(state, name) || isGroupName(name)) return false;
    const key = findPersonKey(state?.characters || {}, name);
    return !key || (!String(state.characters[key]?.core || '').trim() && !state.characters[key]?.hand?.core);
  }).map((name) => name + ' is already tracked but has no identity on their People page');
}
