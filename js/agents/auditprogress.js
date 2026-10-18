import { fingerprint36 } from '../engine/fingerprint.js';
import { pageText } from '../assemble/stack.js';
import { auditSources } from './auditsources.js';
// Factual completion is tied to this contract, never a theme/build release.
const AUDIT_INPUT_VERSION = 1;
// A changed repair procedure can resume an old paused failure once, without
// invalidating completed factual audits merely because an app release changed.
export const LEDGER_REPAIR_POLICY = 11; /* M752 (followup 21): a description the auditor cannot tie to anyone is set aside — a paused audit resumes once; M754: an old close whose thing is closed already is settled, and a loose end is closed where it is written — his paused audit resumes once */
// Fixed legacy formats, so skipping a future app release does not erase an
// already completed M713/M714 review. New receipts never include app VERSION.
const LEGACY_REVIEW_RELEASES = ['m713-001','m714-001'];
import { sourceAppearanceFacts,sourceIdentityFacts } from './appearanceinventory.js';
import { foldName } from '../engine/names.js';
import { findPersonKey } from '../engine/people.js';
import { lookKey } from '../engine/canon.js';

const rowsKey = rows => fingerprint36(JSON.stringify(rows.map(r => [r.id,r.print,r.scope])));
const inputKeyOf = (documents,stateKey) => fingerprint36(JSON.stringify([AUDIT_INPUT_VERSION,documents.map(d => [d.id,d.mark,d.label.endsWith(', writer')]),stateKey]));
export function ledgerRepairStateKey(state) {
  // Identical values stay reviewed when only timestamps/history metadata move.
  return rowsKey(ledgerVerificationRows(state));
}
/* M110: the visible pages up to the last STORY page — a trailing writer's page is an attempt, not yet a source. The
 * auditor reads and keys answered pages only; M752: every check of its saved work makes the same cut (one rule), or a
 * failed send's waiting page unverified a verified ledger and the repair loop paused over findings that did not exist. */
export function answeredPages(list) {
  const visible = (Array.isArray(list) ? list : []).filter((m) => m && !m.hidden);
  let cut = visible.length;
  while (cut > 0 && visible[cut - 1].role === 'user') cut -= 1;
  return visible.slice(0, cut);
}
export function ledgerRepairInputKey(state, story, pages) {
  const sources = auditSources({brief:story?.brief || '',castNotes:story?.castNotes || '',messages:answeredPages(pages)});
  return sourceInputKey(sources,state);
}

function sourceInputKey(documents,state = {}) {
  return inputKeyOf(documents,ledgerRepairStateKey(state));
}
function legacySourceMatches(state,story,pages) {
  if (!Array.isArray(pages)) return false;
  pages = answeredPages(pages); // M713/M714 keyed the auditor's own answered pages
  const fields = ['sheet','clock','place','present','offscreen','characters','relationships','knowledge','canon','threads','things','bodies','factions','mode','worldBrief','lastVerdict','pendingVerdict','duel','battle','composure'];
  const emptyLedger = fingerprint36(JSON.stringify(fields.map(() => null)));
  const inputs = [story?.brief,story?.castNotes,story?.connections,pages.map(p => [p.id,p.role,p.ooc,pageText(p),p.voices || []]),emptyLedger];
  return LEGACY_REVIEW_RELEASES.some(version => state.audit?.verification?.source === fingerprint36(JSON.stringify([version,...inputs])));
}

export function verificationReceiptMatches(receipt, row) {
  return Boolean(receipt && receipt.print === row.print && receipt.scope === row.scope
    && ['correct','repair'].includes(receipt.status));
}

/* M752 (followup 22) — HIS (15 October 2026): "if your explanation are wrong means the auditor can be optimized to be fast
 * while still give the same or better results". Measured on a 200-page, 80-person tale: with every one of its 413 entries
 * approved, the next page's review was asked again for 334 of them — every standing, every person's knowledge and every
 * thread — though not one had changed: an approval was tied to the whole set of originals, and a new page changes the set.
 * 70,000 of its 221,000 characters, every page. An approval of an entry whose value is unchanged now carries over a page that
 * was only ADDED (every original it was given is still there, letter for letter) when that page does not name its subject;
 * an entry of someone the new page names, or of someone in the scene, is reviewed again, the scene and everyone's current
 * state are reviewed every page (M707), and an edited, swiped or deleted older page takes every approval back to review. The reviewer still reads the new
 * page against the whole ledger and may repair any entry. `sources` is what the approvals were given: how many originals,
 * and their fingerprint in order. */
const CARRIED_SECTIONS = new Set(['relationships', 'knowledge', 'threads', 'things', 'bodies', 'factions']);
export function verificationSourcesOf(documents) {
  return { count: documents.length, key: fingerprint36(JSON.stringify(documents.map(d => [d.id, d.mark]))) };
}
/* the words that name a row's subject: its name, a person's other names, a thread's owner; capitalized words of a name
 * stand for it alone ("Kaelen" names "Kaelen Ashford"), a name without capitals is matched whole ("the groom") */
function rowSubjects(state, row) {
  const names = [row.name];
  const key = findPersonKey(state?.characters || {}, row.name);
  if (key) names.push(key, ...(state.characters[key]?.aliases || []));
  if (row.section === 'threads' && row.value?.owner) names.push(row.value.owner);
  return names.filter((n) => typeof n === 'string' && n.trim() && n !== '(empty)');
}
function subjectNamedIn(text, names) {
  const folded = ' ' + foldName(text) + ' ';
  return names.some((name) => {
    const words = String(name).match(/\p{Lu}[\p{L}\p{M}'’-]{2,}/gu) || [];
    if (words.length) return words.some((w) => new RegExp('(^|[^\\p{L}\\p{M}])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{M}])', 'u').test(text));
    const n = foldName(name);
    return Boolean(n) && folded.includes(' ' + n + ' ');
  });
}
export function carriedApprovals(state, documents) {
  const verification = state?.audit?.verification;
  const given = verification?.sources;
  if (!verification?.entries || !given || !Number.isInteger(given.count) || given.count <= 0 || documents.length <= given.count) return {};
  if (verificationSourcesOf(documents.slice(0, given.count)).key !== given.key) return {};
  const added = documents.slice(given.count);
  if (added.some((d) => !/^(?:page|voice):/.test(d.id))) return {};
  const text = added.map((d) => d.text).join('\n');
  /* someone in the scene is often meant without a name ("the lieutenant", "you"): their entries are reviewed again */
  const here = (state?.present || []).map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean);
  const keyOf = (n) => findPersonKey(state?.characters || {}, n) || foldName(n);
  const hereKeys = new Set(here.map(keyOf));
  const inScene = (names) => names.some((n) => hereKeys.has(keyOf(n)));
  const out = {};
  for (const row of ledgerVerificationRows(state)) {
    if (!CARRIED_SECTIONS.has(row.section)) continue;
    const receipt = verification.entries[row.id];
    const subjects = rowSubjects(state, row);
    if (!verificationReceiptMatches(receipt, row) || subjectNamedIn(text, subjects) || inScene(subjects)) continue;
    out[row.id] = receipt;
  }
  return out;
}

const CHECKPOINT_VERSION=1;
const checkpointAuthority=story=>fingerprint36(JSON.stringify([story?.brief || '',story?.castNotes || '']));
const durableSection=row=>['characters','canon'].includes(row.section);

export function reusableAuditCheckpoint(state,story,documents) {
  const checkpoint=state.audit?.checkpoint;
  if (checkpoint?.version!==CHECKPOINT_VERSION || checkpoint.authority!==checkpointAuthority(story)) return {entries:{},profiles:{}};
  const marks=new Map(documents.map(d=>[d.id,d.mark]));
  const reusable=(receipt,row)=>receipt?.print===row.print && receipt.scope===row.scope
    && receipt.dependencies?.length && receipt.dependencies.every(([id,mark])=>marks.get(id)===mark);
  const entries={},profiles={};
  for (const row of ledgerVerificationRows(state).filter(durableSection)) {
    const receipt=checkpoint.entries?.[row.id],partial=checkpoint.profiles?.[row.id];
    if (reusable(receipt,row) && verificationReceiptMatches(receipt,row)) entries[row.id]=receipt;
    if (reusable(partial,row)) profiles[row.id]=partial;
  }
  return {entries,profiles};
}

export function auditCheckpointStart(state,story,documents,pages,latest) {
  const checkpoint=state.audit?.checkpoint;
  if (checkpoint?.version!==CHECKPOINT_VERSION || checkpoint.authority!==checkpointAuthority(story) || !checkpoint.completedThrough) return 0;
  const marks=new Map(documents.map(d=>[d.id,d.mark]));
  if (!Object.entries(checkpoint.scanned || {}).length || Object.entries(checkpoint.scanned).some(([id,mark])=>marks.get(id)!==mark)) return 0;
  const through=pages.findIndex(p=>p.id===checkpoint.completedThrough),end=pages.findIndex(p=>p.id===latest?.id);
  return through>=0 && end>=0?Math.min(through+1,end):0;
}

export function saveAuditCheckpoint(state,story,documents,verification) {
  const entries={},profiles={};
  const originals=new Map(documents.map(d=>[d.id,d]));
  for (const row of ledgerVerificationRows(state).filter(durableSection)) {
    const add=(receipt,book)=>{
      if (!receipt) return;
      const refs=new Set((row.value?.appearanceSources || []).flatMap(f=>f.references || [f.source]));
      for (const f of row.value?.identitySources || []) refs.add(f.source);
      for (const id of receipt.sourceRefs || []) refs.add(id);
      const quotes=[receipt.shown,...(receipt.physicalFacts || []).map(f=>f.shown),...(receipt.appearance || []).map(f=>f.shown),...(receipt.identity || []).map(f=>f.shown)].filter(Boolean);
      for (const [id] of receipt.dependencies || []) refs.add(id);
      for (const quote of quotes) for (const d of documents) if (d.text.includes(quote)) refs.add(d.id);
      const dependencies=[...refs].filter(id=>originals.has(id)).map(id=>[id,originals.get(id).mark]);
      if (dependencies.length) book[row.id]={...receipt,dependencies};
    };
    if (verificationReceiptMatches(verification.entries?.[row.id],row)) add(verification.entries[row.id],entries);
    add(verification.profiles?.[row.id],profiles);
  }
  const prior=state.audit?.checkpoint;
  const completed=verification.read===verification.total;
  const last=[...documents].reverse().find(d=>d.id.startsWith('page:') && d.label.endsWith(', story'));
  return {version:CHECKPOINT_VERSION,authority:checkpointAuthority(story),at:Date.now(),entries,profiles,
    completedThrough:completed && last?last.id.slice(5,last.id.lastIndexOf(':')):prior?.completedThrough,
    scanned:completed?Object.fromEntries(documents.map(d=>[d.id,d.mark])):prior?.scanned,
    source:completed?sourceInputKey(documents):prior?.source};
}

// Actual outstanding work must decrease. Rephrasing ledger text is not closure.
export function repairRetryCheckpoint(before, after, story, pages) {
  // Worker-created voices are checked evidence, but cannot reset retry progress.
  const source = ledgerRepairInputKey({}, story, (pages || []).map(p => ({ ...p, voices: [] })));
  const previous = before.audit?.retryProgress;
  const count = state => (state.audit?.pending || []).length;
  // M752: a repair's work is its TARGET: one person (under any form of the name), field and look. A model that respelled
  // one refused repair each pass ("hair", "hair colour", "Hair color") made "new work" every pass, so the loop never
  // paused and paid for another audit every fifteen seconds while the same target stayed refused.
  const target = (state,m) => { const name = m.name || m.from || ''; return [m.type,foldName(findPersonKey(state.characters || {},name) || name),m.field || '',m.sourceId || '',
    /^canon\./.test(m.type) ? lookKey(m.key || '') : foldName(m.key || ''),foldName(m.title || '')]; };
  const work = state => [...new Set((state.audit?.unresolved || []).map(i=>i.id || i.findingId || fingerprint36(JSON.stringify(
    i.sourceId ? [i.sourceId,i.sourceName || i.name,Boolean(i.sourceFacts),i.facts?.map(f=>f.text)]
      : i.targets?.length ? i.targets : i.mutations?.length ? i.mutations.map(m=>target(state,m)) : i.what))))].sort();
  const currentSource = ledgerRepairInputKey({},story,pages);
  const currentEntries = state => state.audit?.verification?.source === currentSource
    ? ledgerVerificationRows(state).filter(row => verificationReceiptMatches(state.audit.verification.entries?.[row.id],row)) : [];
  const factProgress=state=>{
    if (state.audit?.verification?.source!==currentSource) return 0;
    const verification=state.audit.verification;
    return ledgerVerificationRows(state).filter(row=>row.section==='characters').reduce((total,row)=>{
      const ids=[...(row.value?.appearanceSources || []),...(row.value?.identitySources || [])].map(f=>f.id);
      if (verificationReceiptMatches(verification.entries?.[row.id],row)) return total+ids.length;
      const partial=verification.profiles?.[row.id];
      if (partial?.print!==row.print || partial?.scope!==row.scope) return total;
      const done=new Set([...(partial.appearance || []),...(partial.identity || [])].map(f=>f.id));
      return total+ids.filter(id=>done.has(id)).length;
    },0);
  };
  const read = state => (Number(state.audit?.coverage?.read) || 0) + currentEntries(state).length + factProgress(state);
  const old = previous?.source === source && previous.policy===LEDGER_REPAIR_POLICY ? previous : {
    source, bestPending: count(before), bestRead: read(before), stalled: 0, work:work(before),
  };
  // M752: progress is measured against what this series of repairs has already done, not only against the pass before.
  // Measured pass to pass, work that only took turns counted as new every turn and never paused: a finding that closed
  // and came back ("discovered" again), the same one closing again, an entry verified again after it was reopened — the
  // 1/2/1 churn of M692 in its other forms. A target, a closing and a verified entry count once in a series.
  const afterWork=work(after),beforeWork=work(before);
  const seen=new Set([...(old.seen || []),...(old.work || beforeWork)]);
  const closedOnce=new Set(old.closed || []), verifiedOnce=new Set(old.verified || []);
  const beforeEntries = new Map(currentEntries(before).map(row => [row.id,row.print]));
  const reverified = currentEntries(after).filter(row => beforeEntries.get(row.id) !== row.print).map(row => fingerprint36(row.id+'\n'+row.print));
  const newlyVerified = reverified.some(k => !verifiedOnce.has(k));
  const discovered=afterWork.some(id=>!seen.has(id)) || (old.bestPending===0 && count(after)>0);
  const closedNow=beforeWork.filter(id=>!afterWork.includes(id));
  const closed=closedNow.some(id=>!closedOnce.has(id));
  const decisions=state=>Object.keys(state.audit?.sourceFactDecisions || {});
  const savedDecision=decisions(after).some(id=>!decisions(before).includes(id));
  const improved = closed || savedDecision || count(after) < old.bestPending || read(after) > old.bestRead || newlyVerified;
  return { source, policy:LEDGER_REPAIR_POLICY,work:afterWork,progress:improved || discovered,
    seen:[...new Set([...seen,...afterWork])], closed:[...new Set([...closedOnce,...closedNow])], verified:[...new Set([...verifiedOnce,...reverified])],
    bestPending: discovered ? count(after) : Math.min(old.bestPending, count(after)),
    bestRead: Math.max(old.bestRead, read(after)), stalled: improved || discovered ? 0 : old.stalled + 1 };
}
export function auditHasOpenWork(audit) {
  return Boolean(audit?.unfinished || audit?.pending?.length || audit?.unresolved?.length);
}

// Older completed reviews can prove their original inputs through the saved
// source scratchbook. No rescan just to change a version-dependent hash.
export function matchingAuditSourceCheckpoint(state, story, documents, pages = null) {
  const c = state?.audit?.checkpoint;
  if (c?.version !== CHECKPOINT_VERSION || c.authority !== checkpointAuthority(story)) return false;
  if (JSON.stringify(Object.entries(c.scanned || {})) !== JSON.stringify(documents.map(d => [d.id,d.mark]))) return false;
  if (c.source ? c.source !== sourceInputKey(documents) : !legacySourceMatches(state,story,pages)) return false;
  const last = [...documents].reverse().find(d => d.id.startsWith('page:') && d.label.endsWith(', story'));
  return Boolean(last && c.completedThrough === last.id.slice(5,last.id.lastIndexOf(':')));
}
export function ledgerAuditVerified(state, story, pages) {
  const audit = state?.audit;
  if (!audit?.verifiedInput || auditHasOpenWork(audit) || !audit.coverage
    || audit.coverage.read < audit.coverage.total || !audit.verification) return false;
  const rows = ledgerVerificationRows(state);
  if (!rows.every(row => verificationReceiptMatches(audit.verification.entries?.[row.id],row))) return false;
  // M752: and every approved entry still exists. A write that only REMOVED rows (a thread closed, a seat cleared)
  // left each remaining row matching its receipt, and the checkpoint fallback below compares sources only. The
  // approved ids are the rows of the verified ledger (verifyLedgerChecks keeps receipts for current rows only),
  // so an unchanged legacy M713/M714 completion, whose ledger key was another formula, still matches.
  const current = new Set(rows.map(row => row.id));
  if (!Object.keys(audit.verification.entries || {}).every(id => current.has(id))) return false;
  if (audit.verification.source === ledgerRepairInputKey({},story,pages)
    && audit.verification.ledger === ledgerRepairStateKey(state)
    && audit.verifiedInput === ledgerRepairInputKey(state,story,pages)) return true;
  return matchingAuditSourceCheckpoint(state,story,auditSources({brief:story?.brief || '',castNotes:story?.castNotes || '',messages:answeredPages(pages)}),pages);
}
export function ledgerRepairNeeded(state, shelf = {}, story = null, pages = null, every = 1) {
  if (story && pages && ledgerAuditVerified(state,story,pages)) return false;
  if (story && pages && state?.audit?.pausedPolicy === LEDGER_REPAIR_POLICY
    && state?.audit?.pausedInput === ledgerRepairInputKey(state,story,pages)) return false;
  if ([shelf.auditor,shelf.world].some(r => r?.detail === 'stopped by hand')) return false;
  const audit = state?.audit;
  const turns = (pages || []).filter(m => m.role === 'assistant' && !m.hidden).length;
  const due = turns > 0 && turns % Math.max(1,every) === 0;
  return (due && story && pages && !ledgerAuditVerified(state,story,pages)) || !audit?.coverage
    || audit.coverage.read < audit.coverage.total
    || Boolean(audit.unfinished || audit.pending?.length || shelf.auditor?.ok === false || shelf.auditor?.unfinished);
}

// Every semantic ledger entry is visible even when the prose renderer leans it.
// History/timestamps are bookkeeping, not a replacement for checking the value.
export function ledgerVerificationRows(state) {
  const rows = [];
  const appearance = sourceAppearanceFacts(state);
  const identities=sourceIdentityFacts(state);
  // A biography edit does not erase somebody else's completed review. Identity
  // merges and physical scene changes do invalidate the entries they affect.
  const identity = fingerprint36(JSON.stringify([state?.sheet?.playerName,state?.sheet?.playerAliases || [],
    Object.entries(state?.characters || {}).map(([name,p]) => [name,p.aliases || []])]));
  const ground = [state?.clock?.minutes,state?.place || null];
  const poses = (state?.present || []).map(p => ({name:p.name,position:p.position || '',attire:p.attire || ''}));
  const scene = fingerprint36(JSON.stringify([identity,ground,state?.mode,poses]));
  const personIdentity=name=>[name,state?.characters?.[name]?.aliases || [],state?.sheet?.playerName,state?.sheet?.playerAliases || []];
  const scopeOf = (section,name) => ['scene','presence','offscreen','characterState'].includes(section) ? scene
    : ['characters','canon'].includes(section)?fingerprint36(JSON.stringify(personIdentity(name))):identity;
  const add = (section, name, value, judgment = false) => {
    const id = section + ':' + name;
    // A later page repeating an already known fact adds provenance, not a new
    // appearance to approve. Preserve the full references for the reader/book.
    const printed=section==='characters' && value?{...value,appearanceSources:(value.appearanceSources || []).map(({references,...fact})=>fact)}:value;
    rows.push({ id, section, name, value, judgment, scope:scopeOf(section,name),print: fingerprint36(JSON.stringify(printed)) });
  };
  const semantic = value => {
    if (Array.isArray(value)) return value.map(semantic);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([k]) => !['atTurn', 'updatedAtTurn', 'atMinutes', 'sinceMinutes', 'checkedMinutes', 'ts', 'history'].includes(k)).map(([k,v]) => [k,semantic(v)]));
  };
  add('scene', 'clock', semantic(state?.clock));
  add('scene', 'place', state?.place || null);
  add('scene', 'mode', state?.mode || {});
  add('scene', 'roster', (state?.present || []).map(p => p.name));
  for (const p of state?.present || []) add('presence', p.name, {position:p.position || '',attire:p.attire || ''});
  for (const section of ['offscreen','characters','relationships','knowledge','canon','things','bodies','factions']) {
    const entries = Object.entries(state?.[section] || {});
    if (!entries.length) add(section, '(empty)', null, true);
    for (const [name, entry] of entries) {
      const value = section === 'characters'
        ? {...Object.fromEntries(['core','coreOrigin','aliases','retired'].filter(k => entry?.[k] !== undefined).map(k => [k,entry[k]])),hand:{core:entry?.hand?.core || false},physicalFacts:semantic(state.canon?.[name] || null),appearanceSources:appearance.filter(f => f.name === name),identitySources:identities.filter(f=>f.name===name)}
        : semantic(entry);
      add(section, name, value, ['offscreen','relationships','factions'].includes(section));
      if (section==='characters') add('characterState',name,semantic({state:entry?.state || '',arc:entry?.arc || '',threads:entry?.threads || [],hand:entry?.hand || {}}));
    }
  }
  for (const t of state?.threads || []) add('threads', t.title, semantic(t), true);
  if (!state?.threads?.length) add('threads', '(empty)', null, true);
  add('rules', 'sheet', semantic(state?.sheet || {}), true);
  add('rules', 'worldBrief', semantic(state?.worldBrief || null), true);
  add('rules', 'lastVerdict', semantic(state?.lastVerdict || null), true);
  for (const field of ['pendingVerdict','duel','battle','composure']) add('rules', field, semantic(state?.[field] ?? null), true);
  return rows;
}

/* M752 (followup 15) — A BRANCH'S ORIGINALS ARE THE SAME ORIGINALS. HIS (15 October 2026), on a branch of his long tale
 * with Choices matter on: "the audit is so slow" — "278 original source sections still need review … ledger verification:
 * checked 4 of 257 entries". A source section is named by its page's id ('page:<id>:<offset>', 'voice:<id>:<n>:<offset>')
 * and a branch copies every page under a new id: the ledger it carried held every receipt the auditor had paid for (the
 * source review, the people it resolved, the entries it approved, its checkpoint), each named for the parent's pages, so
 * the branch found none of them and read the whole tale again, a section batch per run. The copies are the same text (a
 * section's mark is its length and hash, checked again before any reuse), so every name for a parent page is turned to its
 * copy's; an approval whose print was the parent ledger's is kept for the same row of this one (only the names in it
 * moved); and a completion key computed over the parent's pages is recomputed over the copies — only where it was that
 * key, so a ledger carried from another point stays unverified. Pages not copied keep their names (nothing reads them). */
const SOURCE_NAME = /^(page|voice):([^:]+)(:.+)$/;
export function branchAuditBooks(state, idMap, { story = null, from = [], to = [] } = {}) {
  if (!state || typeof state !== 'object' || !idMap || !Object.keys(idMap).length) return state;
  const named = s => { const m = SOURCE_NAME.exec(s); return m && idMap[m[2]] ? m[1] + ':' + idMap[m[2]] + m[3] : s; };
  const walk = v => {
    if (typeof v === 'string') return named(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [named(k), walk(x)]));
    return v;
  };
  const out = walk(state);
  const audit = out.audit;
  if (!audit || typeof audit !== 'object') return out;
  if (audit.checkpoint && idMap[audit.checkpoint.completedThrough]) audit.checkpoint.completedThrough = idMap[audit.checkpoint.completedThrough];
  /* the approvals and completion keys only for the ledger the branch opens on (story given): the rows are costly to read
   * on a long tale, and a checkpoint's approvals, if one is ever opened again, are checked again — its sources are not */
  if (!story || !Array.isArray(from) || !Array.isArray(to)) return out;
  const rowsBefore = ledgerVerificationRows(state), rowsAfter = ledgerVerificationRows(out);
  const before = new Map(rowsBefore.map(r => [r.id, r])), after = new Map(rowsAfter.map(r => [r.id, r]));
  const reprint = book => {
    for (const [id, receipt] of Object.entries(book || {})) {
      const was = before.get(id), now = after.get(id);
      if (receipt && was && now && receipt.print === was.print && receipt.scope === was.scope) book[id] = { ...receipt, print: now.print, scope: now.scope };
    }
  };
  reprint(audit.verification?.entries); reprint(audit.verification?.profiles);
  reprint(audit.checkpoint?.entries); reprint(audit.checkpoint?.profiles);
  const docs = pages => auditSources({ brief: story.brief || '', castNotes: story.castNotes || '', messages: answeredPages(pages) });
  const docsFrom = docs(from), docsTo = docs(to);
  const keyBefore = rowsKey(rowsBefore), keyAfter = rowsKey(rowsAfter);
  const swap = (field, holder, old, now) => { if (holder && holder[field] && holder[field] === old) holder[field] = now; };
  /* the same keys as ledgerRepairInputKey, ledgerRepairStateKey and sourceInputKey, each read once */
  const inputBefore = inputKeyOf(docsFrom, keyBefore), inputAfter = inputKeyOf(docsTo, keyAfter);
  swap('verifiedInput', audit, inputBefore, inputAfter);
  swap('pausedInput', audit, inputBefore, inputAfter);
  const bare = rowsKey(ledgerVerificationRows({}));
  swap('source', audit.verification, inputKeyOf(docsFrom, bare), inputKeyOf(docsTo, bare));
  swap('ledger', audit.verification, keyBefore, keyAfter);
  swap('source', audit.checkpoint, inputKeyOf(docsFrom, bare), inputKeyOf(docsTo, bare));
  return out;
}
