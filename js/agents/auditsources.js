import { ownerAndDependent, sameOwnedDescriptor } from '../engine/names.js';
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

const VERSION = 2;
const MAX_TOKENS = 6000;
const CHUNK = 12000;
const OVERLAP = 1200;
const writerSource = d => /^(?:brief|cast):/.test(d.id) || d.label.endsWith(', writer');

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
    for (const [v, voice] of (m.voices || []).entries()) if (voice?.content) add('voice:' + m.id + ':' + v, 'World voice after page ' + (i + 1), voice.speaker + (voice.channel ? ', ' + voice.channel : '') + ': ' + voice.content);
  }
  return documents;
}

const SYSTEM = withFictionFrame([
  'SOURCE PEOPLE REVIEW. You are the ledger auditor reading ORIGINAL source documents, not a summary.',
  WRITER_FACTS,
  'Find every individually established person in these documents, including people with proper names AND unique singular role labels copied exactly from the source. A ranked sibling, an individually described heir or an established relative gets their own identity even when no personal name was supplied. Do not require them to have entered the main scene. Keep ordinal ranks distinct; do not turn a character used as a comparison or design reference into another story person. Do not invent a personal name for a role.',
  'princes, princesses and people introduced only by the writer. The ledger may have lost them completely.',
  'Do not assess their present whereabouts from old pages. Do not invent a biography, surname, title or rank.',
  'Ignore hypothetical characters, wishes, questions about possible people, names used only as comparisons,',
  'and instructions asking for a character to be created later. Keep deceased people as established identities.',
  'For each person copy an exact short passage that establishes their identity and includes their exact name.',
  'Also collect EVERY explicitly established lasting physical fact for that person in this document: hair, eyes, skin, build, height, scars and other enduring features. Use facts:[] when none is established. Read the complete document, including descriptions linked by pronouns. Current clothes, poses and expressions are not lasting facts. Do not infer missing details. Preserve changes as separate sourced facts; the final housekeeper resolves chronology.',
  'Collect identityFacts:[{text,shown}] for explicit rank, family, background, stable personality and preferences. Use identityFacts:[] when none is established. These are atomic facts to retain in their People core, not a rewritten biography. Exclude guessed feelings, speculative attraction, questions and momentary actions. A deliberate character introduction in a parenthesis is still writer-established. Appearance belongs in facts, not identityFacts. Record alternate faces with their explicit persona or form in each physical fact key, keeping one player identity; alternate appearances are not mutually superseding hair colours.',
  'Return JSON: {"checked":["each source id actually read"],"people":[{"name":"exact name",',
  '"source":"source id","shown":"exact identity quote, at most 1200 characters","identityFacts":[{"text":"explicit stable identity fact","shown":"exact source quote"}],"facts":[{"key":"hair","value":"established colour","shown":"exact original passage supporting this physical fact"}]}]}.',
  'Read every supplied document. List its id in checked even when it establishes no named people.',
  'The same person needs one informative quote per document, not every mention. Never quote from your instructions.',
].join('\n'));

export function parseSourceReview(text, batch) {
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
    if (!name || name.length > 80 || !shown || !exactNameIn(shown, name) || isGroupName(name) || !Array.isArray(p.facts)) { invalid.add(source.id); continue; }
    const facts = p.facts.map(f => ({key:String(f?.key || '').trim(),value:String(f?.value || '').trim(),shown:quotedSource(source.text,f?.shown)}));
    const identityFacts=Array.isArray(p.identityFacts)?p.identityFacts.map(f=>({text:String(f?.text || '').trim(),shown:quotedSource(source.text,f?.shown)})):[];
    if ((writerSource(source) && !Array.isArray(p.identityFacts)) || identityFacts.some(f=>!f.text || !f.shown || f.text.length>1000)) {invalid.add(source.id);continue;}
    if (facts.some(f => !f.key || !f.value || !f.shown || f.key.length > 120 || f.value.length > 1000)) { invalid.add(source.id); continue; }
    if (!people.has(source.id)) people.set(source.id, []);
    const prior = people.get(source.id).find(x => x.name === name);
    if (prior) {prior.facts.push(...facts.filter(f => !prior.facts.some(old => JSON.stringify(old) === JSON.stringify(f))));prior.identityFacts.push(...identityFacts);}
    else people.get(source.id).push({ name, shown, facts,identityFacts });
  }
  return Object.fromEntries([...checked].filter((id) => !invalid.has(id)).map((id) => [id, { mark: sources.get(id).mark, appearanceReviewed:true,profileReviewed:1, people: people.get(id) || [] }]));
}

export async function reviewAuditSources({ connection, documents, previous = {}, mode = 'next', state = {}, signal, stale, renew } = {}) {
  const cache = {};
  for (const d of documents) {
    const old = previous[d.id];
    if (old?.mark === d.mark && old.appearanceReviewed === true && (!writerSource(d) || old.profileReviewed===1) && Array.isArray(old.people) && old.people.every((p) => quotedSource(d.text, p.shown) && exactNameIn(p.shown, p.name)
      && (p.identityFacts || []).every(f=>f.text && quotedSource(d.text,f.shown))
      && Array.isArray(p.facts) && p.facts.every(f => f.key && f.value && quotedSource(d.text,f.shown)))) cache[d.id] = old;
  }
  const todo = documents.filter((d) => !cache[d.id]);
  const limit = Math.max(1000, Math.min(24000, roomChars(connection, MAX_TOKENS) * 0.6 - SYSTEM.length));
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
      const reviewed = parseSourceReview(result.text,batch);
      Object.assign(cache,reviewed);
      if (batch.some(d => !reviewed[d.id])) failure = 'source identity or appearance evidence was incomplete';
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
  if (direct && !String(characters[direct]?.core || '').trim() && !characters[direct]?.hand?.core) {
    const complete = Object.keys(characters).filter(k => k !== direct && sameOwnedDescriptor(k, name)
      && String(characters[k]?.core || '').trim());
    if (complete.length === 1) return complete[0];
  }
  if (direct) return direct;
  let renamed = name;
  for (const entry of state.journal || []) {
    const m = entry?.m;
    if (m?.type === 'people.rename' && !(!m.byHand && ownerAndDependent(m.from, m.to)) && String(m.from || '').toLowerCase() === String(renamed).toLowerCase()) renamed = m.to;
  }
  if (renamed !== name) return findPersonKey(characters, renamed);
  if (!remembered) remembered = Object.values(state.auditSources || {}).flatMap((r) => r.people || [])
    .find((p) => String(p.name || '').toLowerCase() === String(name || '').toLowerCase())?.ledgerName || '';
  return remembered && !ownerAndDependent(name, remembered) ? findPersonKey(characters, remembered) : '';
}

export function missingSourcePeople(state, people = []) {
  const known = { ...(state?.characters || {}) }; const issues = []; const requested = new Set();
  for (const p of people) {
    if (isMc(state, p.name)) continue;
    const key = sourcePersonKey({ ...state, characters: known }, p.name, p.ledgerName);
    if (key && (String(known[key]?.core || '').trim() || known[key]?.hand?.core)) continue;
    const name = key || p.name;
    if (requested.has(name)) continue;
    requested.add(name);
    // A quoted occurrence proves the person exists. It is not their biography.
    // Ask for a sourced identity; never commit the quote as a synthetic core.
    issues.push({ what: name + ' was established in ' + p.label + ' but has no identity on their People page.',
      name, profileRecovery: true, shown:p.shown,
      fix: 'Read their original sources and write their stable identity and missing physical facts. Do not copy an event quotation into core.', pages: false, mutations: [] });
  }
  return issues;
}

// All original references for each identity, including old pages and aliases.
// This is a lookup index, not another model call or an inferred biography.
export function peopleSourceIndex(state, documents, people = []) {
  const names = new Set([...Object.keys(state?.characters || {}), ...people.map(p => sourcePersonKey(state,p.name,p.ledgerName) || p.name)]);
  return [...names].filter(name => name && !isMc(state,name) && !isGroupName(name)).map(name => {
    const aliases = [...new Set([name,...(state.characters?.[name]?.aliases || []),...people.filter(p => (sourcePersonKey(state,p.name,p.ledgerName) || p.name) === name).map(p => p.name)])];
    return {name,aliases,sources:documents.filter(d => aliases.some(alias => exactNameIn(d.text,alias))).map(d => ({id:d.id,label:d.label}))};
  });
}

export function missingLedgerPeople(state, castNames = []) {
  const names = new Set([
    ...(state?.present || []).map((p) => p.name), ...Object.keys(state?.offscreen || {}),
    ...Object.keys(state?.relationships || {}), ...Object.keys(state?.knowledge || {}),
    ...Object.keys(state?.canon || {}), ...Object.keys(state?.sheet?.actors || {}), ...castNames,
  ]);
  return [...names].filter((name) => {
    if (!name || isMc(state, name) || isGroupName(name)) return false;
    const key = sourcePersonKey(state, name);
    return !key || (!String(state.characters[key]?.core || '').trim() && !state.characters[key]?.hand?.core);
  }).map((name) => name + ' is already tracked but has no identity on their People page');
}
