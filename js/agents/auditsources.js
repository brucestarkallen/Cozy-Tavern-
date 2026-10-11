import { ownerAndDependent, sameOwnedDescriptor } from '../engine/names.js';
/* M685: source coverage for the ledger audit. A missing person cannot be found
 * by checking only the records that survived. Read original answered pages,
 * keep receipts tied to their exact text, and recover only quoted identities.
 * This is evidence for the auditor, never a second simulation of the present. */
import { callWorker, workerConnection } from './call.js';
import { balancedCandidates, parseLenient } from './jsonutil.js';
import { withFictionFrame } from './voice.js';
import { asideAt } from '../commands.js';
import { pageText } from '../assemble/stack.js';
import { djb2 } from '../engine/fingerprint.js';
import { exactNameIn, quotedSource, WRITER_FACTS } from '../engine/evidence.js';
import { findPersonKey, isMc, isGroupName } from '../engine/people.js';
import { leashFor } from './lookup.js';
import { contextOf } from '../providers/room.js';

const VERSION = 2;
const MAX_TOKENS = 16000;
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

// The model selects original passages; it does not have to reproduce their
// punctuation, Markdown or labels. References are local to one unchanged
// source chunk. Receipts still store literal text, so old consumers and source
// marks are unchanged and completed sections need no migration or reread.
export function sourcePassages(document) {
  const text = String(document.text || '');
  const passages = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1000, text.length);
    const paragraph = text.slice(start, end).match(/\r?\n[ \t]*\r?\n/);
    if (paragraph) end = start + paragraph.index + paragraph[0].length;
    else if (end < text.length) {
      const line = text.lastIndexOf('\n', end);
      const space = text.lastIndexOf(' ', end);
      const boundary = line > start + 400 ? line : space;
      if (boundary > start + 400) end = boundary + 1;
    }
    passages.push({ id: 'p' + start, text: text.slice(start, end), start, end });
    start = end;
  }
  return passages;
}
const sourceDocument = d => ({ id:d.id, label:d.label,
  passages:sourcePassages(d).map(({id,text}) => ({id,text})) });
function sourceEvidence(document, row, passages) {
  if (row?.evidence !== undefined) {
    const ids = Array.isArray(row.evidence) ? row.evidence : [row.evidence];
    const spans = ids.map(id => passages.get(id));
    if (!spans.length || spans.some(span => !span)) return '';
    // A fact spanning passages retains the intervening original words too.
    return document.text.slice(Math.min(...spans.map(s => s.start)), Math.max(...spans.map(s => s.end)));
  }
  return quotedSource(document.text, row?.shown);
}

const SYSTEM = withFictionFrame([
  'SOURCE PEOPLE REVIEW. You are the ledger auditor reading ORIGINAL source documents, not a summary.',
  WRITER_FACTS,
  'Identify the actual subject FIRST. A proper-name occurrence is not proof of a person. Places, kingdoms, organizations and objects are not individuals unless explicitly personified as characters. In "Prince NAME of REALM", NAME owns his appearance and REALM is the place. Never assign the prince\'s eyes, face or age to his homeland. Resolve relative clauses and pronouns to their actual subject. Use kind:"person" for individual beings, kind:"place", "organization", "object" or "group" for a nonperson reference worth disambiguating. Nonperson rows retain provenance but do not create People or physical facts. Do not omit a real unnamed individual or an animal merely because they lack a proper name.',
  'Find every individually established person in these documents, including people with proper names AND unique singular role labels copied exactly from the source. A ranked sibling, an individually described heir or an established relative gets their own identity even when no personal name was supplied. Do not require them to have entered the main scene. Keep ordinal ranks distinct; do not turn a character used as a comparison or design reference into another story person. Do not invent a personal name for a role.',
  'princes, princesses and people introduced only by the writer. The ledger may have lost them completely.',
  'Do not assess their present whereabouts from old pages. Do not invent a biography, surname, title or rank.',
  'Ignore hypothetical characters, wishes, questions about possible people, names used only as comparisons,',
  'and instructions asking for a character to be created later. Keep deceased people as established identities.',
  'Each original document is supplied as ordered passages with local ids. Read ALL passages as one document. For each identity and fact select evidence:"passage id" from that document. If support spans passages, use evidence:["first passage id","last passage id"]; the original intervening text is retained. Do not retype or paraphrase quotations. Never select a passage from a different source.',
  'You decide the meaning and actual subject from the complete original document. A passage may use a pronoun or a shorter name than the established ledger label. A title established separately need not be repeated inside every supporting passage. Keep the established name and distinguish different individuals. Selecting an unrelated passage does not establish a fact.',
  'Resolve descriptions, pronouns and temporary labels to the SAME individual within the source. When their name is established, use that name, not an additional identity for each description. Existing ledger identities are recall hints, not proof. A generic description can refer to different people in different pages. Do not turn an already named princess into a new person because dialogue calls her a girl.',
  'Also collect EVERY explicitly established lasting physical fact for that person in this document: hair, eyes, skin, build, height, scars and other enduring features. Use facts:[] when none is established. Read the complete document, including descriptions linked by pronouns. Current clothes, poses and expressions are not lasting facts. Do not infer missing details. Preserve changes as separate sourced facts; the final housekeeper resolves chronology.',
  'Collect identityFacts:[{text,evidence}] for explicit rank, family, background, stable personality and preferences. Use identityFacts:[] when none is established. These are atomic facts to retain in their People core, not a rewritten biography. Exclude guessed feelings, speculative attraction, questions and momentary actions. A deliberate character introduction in a parenthesis is still writer-established. Appearance belongs in facts, not identityFacts. Record alternate faces with their explicit persona or form in each physical fact key, keeping one player identity; alternate appearances are not mutually superseding hair colours.',
  'Return JSON: {"checked":["each source id actually read"],"people":[{"name":"established name or singular role",',
  '"kind":"person","source":"source id","evidence":"passage id","identityFacts":[{"text":"explicit stable identity fact","evidence":"passage id"}],"facts":[{"key":"hair","value":"established colour","evidence":"passage id"}]}]}.',
  'Read every supplied document. List its id in checked even when it establishes no named people.',
  'The same person needs one informative identity reference per document, not every mention. Evidence ids are references to supplied original text, never to your instructions or your own answer.',
].join('\n'));

// Diagnose the transport beside the receipts. One bad row must not erase the
// completed receipts from other sources, or leave an opaque endless retry.
export function sourceReviewResult(text, batch) {
  let parsed;
  for (const part of balancedCandidates(String(text || '').replace(/<think>[\s\S]*?(<\/think>|$)/gi, ''), 5)) {
    const p = parseLenient(part);
    if (p && Array.isArray(p.people) && Array.isArray(p.checked)) { parsed = p; break; }
  }
  const problems = [];
  const fail = (source, why, name = '') => problems.push({ source, why, ...(name ? { name } : {}) });
  if (!parsed) {
    for (const d of batch) fail(d.id, 'Return JSON with checked and people arrays.');
    return { receipts: {}, problems };
  }
  const sources = new Map(batch.map(d => [d.id, d]));
  const passages = new Map(batch.map(d => [d.id,new Map(sourcePassages(d).map(p => [p.id,p]))]));
  const checked = new Set(parsed.checked.filter(id => sources.has(id)));
  const invalid = new Set(); const people = new Map();
  for (const d of batch) if (!checked.has(d.id)) fail(d.id, 'This source id was omitted from checked. Read it and include its exact id.');
  for (const p of parsed.people) {
    const source = sources.get(p?.source);
    if (!source) {
      for (const d of batch) { invalid.add(d.id); fail(d.id, 'A person used an unknown source id. Use an exact supplied id and its original quotation.', String(p?.name || '').slice(0,80)); }
      continue;
    }
    const name = String(p.name || '').trim();
    const kind = p.kind || 'person';
    const shown = sourceEvidence(source,p,passages.get(source.id));
    const reasons = [];
    if (!name || name.length > 80) reasons.push('Use an established name or unique singular role of at most 80 characters.');
    if (!['person','place','organization','object','group'].includes(kind)) reasons.push('Classify kind as person, place, organization, object or group.');
    if (!shown) reasons.push('Select an identity evidence passage id supplied in this source document.');
    if (!Array.isArray(p.facts)) reasons.push('Include facts:[] when no lasting appearance is stated.');
    if (writerSource(source) && !Array.isArray(p.identityFacts)) reasons.push('Include identityFacts:[] when no lasting identity facts are stated.');
    const facts = (Array.isArray(p.facts) ? p.facts : []).map(f => ({key:String(f?.key || '').trim(),value:String(f?.value || '').trim(),shown:sourceEvidence(source,f,passages.get(source.id))}));
    const identityFacts = (Array.isArray(p.identityFacts) ? p.identityFacts : []).map(f => ({text:String(f?.text || '').trim(),shown:sourceEvidence(source,f,passages.get(source.id))}));
    for (const f of facts) if (!f.key || !f.value || !f.shown || f.key.length > 120 || f.value.length > 1000) reasons.push('Appearance '+(f.key || '(unnamed)')+' needs a key, value and an evidence passage id from this source.');
    for (const f of identityFacts) if (!f.text || !f.shown || f.text.length > 1000) reasons.push('Each identity fact needs concise text and an evidence passage id from this source.');
    if (reasons.length) { invalid.add(source.id); for (const why of reasons) fail(source.id,why,name); continue; }
    if (!people.has(source.id)) people.set(source.id, []);
    const prior = people.get(source.id).find(x => x.name === name);
    if (prior) { prior.facts.push(...facts.filter(f => !prior.facts.some(old => JSON.stringify(old) === JSON.stringify(f)))); prior.identityFacts.push(...identityFacts); }
    else people.get(source.id).push({name,kind,shown,facts,identityFacts});
  }
  const receipts = Object.fromEntries([...checked].filter(id => !invalid.has(id)).map(id => [id,{mark:sources.get(id).mark,appearanceReviewed:true,profileReviewed:1,people:people.get(id) || []}]));
  return { receipts, problems };
}
export function parseSourceReview(text, batch) { return sourceReviewResult(text,batch).receipts; }

export async function reviewAuditSources({ connection, documents, previous = {}, mode = 'next', state = {}, signal, stale, renew } = {}) {
  const cache = {};
  for (const d of documents) {
    const old = previous[d.id];
    if (old?.mark === d.mark && old.appearanceReviewed === true && (!writerSource(d) || old.profileReviewed===1) && Array.isArray(old.people) && old.people.every((p) => quotedSource(d.text, p.shown)
      && (p.identityFacts || []).every(f=>f.text && quotedSource(d.text,f.shown))
      && Array.isArray(p.facts) && p.facts.every(f => f.key && f.value && quotedSource(d.text,f.shown)))) cache[d.id] = old;
  }
  const todo = documents.filter((d) => !cache[d.id]);
  const system = SYSTEM + '\nEXISTING LEDGER IDENTITY HINTS, resolve against originals, never infer an identity solely from these: '
    + JSON.stringify(Object.entries(state.characters || {}).map(([name,p]) => ({name,aliases:p.aliases || [],identity:String(p.core || '').slice(0,220)})))
    + '\nPLAYER IDENTITY HINT: '+JSON.stringify({name:state.sheet?.playerName,aliases:state.sheet?.playerAliases || []});
  const replyTokens = workerConnection(connection, { maxTokens: Math.min(MAX_TOKENS, Math.max(6000, Number(connection?.maxTokens) || MAX_TOKENS)) }).maxTokens;
  // Pack original chunks by the real connection room and answer allowance.
  // Keep ids/marks unchanged so existing scratchbook receipts remain reusable.
  const available = Math.max(0, (contextOf(connection) - replyTokens - 3000) * 3 - system.length);
  let limit = Math.max(0, Math.min(120000, replyTokens * 12, available * 0.6));
  let calls = 0; let cursor = 0; let failure = '';
  const sourceProblems = new Map();
  let retryBatch = false;
  while (cursor < todo.length && (mode === 'all' || calls === 0 || retryBatch)) {
    if (stale?.() || signal?.aborted) return null;
    retryBatch = false;
    const start = cursor;
    const batch = []; let size = 0;
    while (cursor < todo.length) {
      const d = todo[cursor]; const cost = JSON.stringify(sourceDocument(d)).length + 1;
      if (size + cost > limit) break;
      batch.push(d); size += cost; cursor++;
    }
    if (!batch.length) { failure = 'the source page does not fit the auditor’s configured context'; break; }
    renew?.(); calls++;
    try {
      const user = 'SOURCE DOCUMENTS\n' + JSON.stringify(batch.map(sourceDocument));
      renew?.(leashFor(system.length + user.length));
      const result = await callWorker(connection, { system, messages: [{ role: 'user', content: user }], maxTokens: replyTokens, signal });
      if (stale?.() || signal?.aborted) return null;
      // A truncated answer cannot certify that its final document was read.
      if (result.finishReason === 'length') {
        failure = 'the source review ran out of answer space';
        if (batch.length > 1) {
          // Retry this work at a smaller size rather than losing the entire
          // batch and rediscovering it in another automatic audit cycle.
          cursor = start; limit = Math.max(JSON.stringify(sourceDocument(batch[0])).length + 1, Math.floor(size / 2)); retryBatch = true;
        }
        continue;
      }
      const first = sourceReviewResult(result.text,batch);
      Object.assign(cache,first.receipts);
      const missing = batch.filter(d => !cache[d.id]);
      let problems = first.problems;
      for (const d of missing) sourceProblems.set(d.id,problems.filter(p => p.source === d.id));
      if (missing.length) {
        // One correction of this answer, in its original conversation. Keep
        // valid receipts; do not restart the complete ledger or source scan.
        const ids = new Set(missing.map(d => d.id));
        const correction = 'Complete the SAME source reading. These exact source sections are unfinished: '
          + JSON.stringify(missing.map(d => ({id:d.id,label:d.label})))
          + '\nCorrect these transport problems: ' + JSON.stringify(problems.filter(p => ids.has(p.source)).slice(0,40))
          + '\nReturn complete JSON with checked and people for ONLY these unfinished source ids. Select evidence passage ids from the original documents above; the application attaches their original text. Do not copy quotations. Name labels, titles and pronouns need not match word for word inside each passage: you decide their actual subject from the full document. Include facts and identityFacts arrays, even when empty. Keep every supported individual and their established facts. Do not omit a fact merely to pass validation. Collectives remain tracked in Scene; they are not individual identity rows. Valid receipts for other sources are already saved.';
        renew?.(leashFor(system.length + user.length + result.text.length + correction.length)); calls++;
        const fixed = await callWorker(connection,{system,messages:[{role:'user',content:user},{role:'assistant',content:result.text},{role:'user',content:correction}],maxTokens:replyTokens,signal});
        if (stale?.() || signal?.aborted) return null;
        if (fixed.finishReason !== 'length') {
          const repaired = sourceReviewResult(fixed.text,missing);
          Object.assign(cache,repaired.receipts); problems = repaired.problems;
        } else problems = missing.map(d => ({source:d.id,why:'The focused source correction ran out of answer space.'}));
      }
      for (const d of missing) if (!cache[d.id]) sourceProblems.set(d.id,problems.filter(p => p.source === d.id));
      if (missing.some(d => !cache[d.id])) failure = 'source identity or appearance evidence was incomplete';
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
  const failures = unread.map(d => ({source:d.id,label:d.label,mark:d.mark,problems:(sourceProblems.get(d.id) || [{why:failure || 'This original section has not been read yet.'}]).slice(0,8)}));
  return { cache, people, calls, failures, total: documents.length, read: documents.length - unread.length,
    pending: unread.length ? [unread.length + ' original source sections still need review' + (failure ? ': ' + failure : '')] : [] };
}

/* Receipts retain their original quotation. Their ledger name follows a real
 * recorded merge, including a merge made before aliases were stored in M687. */
export function sourcePersonKey(state, name, remembered = '') {
  const characters = state?.characters || {};
  const tracked = [...(state?.present || []).map(p => p.name),
    ...['offscreen','relationships','knowledge','canon'].flatMap(book => Object.keys(state?.[book] || {})),
    ...Object.keys(state?.sheet?.actors || {})];
  const exactTracked = name => tracked.find(n => String(n).trim().toLowerCase() === String(name).trim().toLowerCase()) || '';
  // Explicit remembered mappings belong to this source row, not every future
  // use of the descriptor. Never borrow another page's 'the girl' mapping.
  if (remembered) {
    if (isMc(state,remembered)) return state.sheet?.playerName || remembered;
    const resolved = findPersonKey(characters,remembered);
    if (resolved) return resolved;
    if (exactTracked(remembered)) return exactTracked(remembered);
  }
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
  return exactTracked(name);
}

export function sourceIdentityNeeded(state, person) {
  if (person.kind && person.kind !== 'person') return false;
  const key = sourcePersonKey(state, person.name, person.ledgerName);
  if (isMc(state, key || person.name)) return false;
  if (!key) return true; // Unclassified original individual, including unique unnamed roles.
  if (state.characters?.[key]?.hand?.core || String(state.characters?.[key]?.core || '').trim()) return false;
  return (person.identityFacts || []).some(f => f.text && f.shown);
}

export function missingSourcePeople(state, people = []) {
  const known = { ...(state?.characters || {}) }; const issues = []; const requested = new Set();
  for (const p of people) {
    if (p.kind && p.kind !== 'person') continue;
    if (isMc(state, p.name)) continue;
    const key = sourcePersonKey({ ...state, characters: known }, p.name, p.ledgerName);
    if (key && isMc(state,key)) continue;
    if (!sourceIdentityNeeded({ ...state, characters: known }, p)) continue;
    const name = key || p.name;
    const target = JSON.stringify([p.source,p.name]);
    if (requested.has(target)) continue;
    requested.add(target);
    // An extraction is a candidate, not proof that every quoted proper name
    // is a person. Review its subject before requesting a biography.
    issues.push({ what: name + ' is listed as an individual by the source reading in ' + p.label + '; confirm its identity or correct its entity classification.',
      name, sourceId:p.source,sourceName:p.name,profileRecovery: true, shown:p.shown,
      fix: 'Resolve this mention in its original source. If it describes a known person, return identities:[{sourceId,name,to:"existing person",kind:"person",why}]; this binds only this source mention, never a global alias. For a genuinely new person supply their profile first. For a nonperson or comparison-only reference use its actual kind, including reference. Do not create another biography for a contextual description.', pages: false, mutations: [] });
  }
  return issues;
}

// All original references for each identity, including old pages and aliases.
// This is a lookup index, not another model call or an inferred biography.
export function peopleSourceIndex(state, documents, people = []) {
  people = people.filter(p => !p.kind || p.kind === 'person');
  const names = new Set([...Object.keys(state?.characters || {}), ...people.map(p => sourcePersonKey(state,p.name,p.ledgerName) || p.name)]);
  return [...names].filter(name => name && !isMc(state,name) && !isGroupName(name)).map(name => {
    const mentions = people.filter(p => (sourcePersonKey(state,p.name,p.ledgerName) || p.name) === name);
    const aliases = [...new Set([name,...(state.characters?.[name]?.aliases || []),...mentions.map(p => p.name)])];
    const selectedSources = new Set(mentions.map(p => p.source));
    // The reader already bound this identity to an original section. Do not
    // lose that reference because its label differs from the local wording.
    return {name,aliases,sources:documents.filter(d => selectedSources.has(d.id) || aliases.some(alias => exactNameIn(d.text,alias))).map(d => ({id:d.id,label:d.label}))};
  });
}

export function missingLedgerPeople(state, castNames = []) {
  // Compatibility view of the SAME source policy, never a biography demand
  // inferred from the existence of a seat, relationship or physical fact.
  const people = Object.entries(state?.auditSources || {}).flatMap(([source, r]) =>
    (r.people || []).map(p => ({...p, source, label:source})));
  return missingSourcePeople(state, people).map(i => i.what);
}
