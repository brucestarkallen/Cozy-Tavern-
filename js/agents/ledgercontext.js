/* Shared interpretation contract for the ledger readers. No model call. */
import { fingerprint36 } from '../engine/fingerprint.js';
import { quotedSource } from '../engine/evidence.js';
import { isMc, findPersonKey } from '../engine/people.js';
import { findCanonKey, findFact } from '../engine/canon.js';
import { isHere, nameOnPage } from '../engine/names.js';
import { sourceAppearanceFacts, sourceIdentityFacts } from './appearanceinventory.js';

// Workers maintain the records; the storyteller's card/recall limits are not
// their reading contract. Keep complete selected records and name every other
// record for lookup. A field omitted from this view is never an empty field.
export function workerPeopleContext(state, { material = '', room = 60000 } = {}) {
  const rows = Object.entries(state?.characters || {}).filter(([name, c]) => c && (!c.retired || nameOnPage(material, name)))
    .map(([name, c]) => ({ name, c, priority: (isMc(state, name) ? 4 : 0)
      + (isHere(state, name) ? 3 : 0) + (nameOnPage(material, name) ? 2 : 0) }))
    .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  const blocks = []; const omitted = []; let used = 0;
  for (const { name, c } of rows) {
    const block = JSON.stringify({ name, core: c.core || '', state: c.state || '', arc: c.arc || '',
      threads: c.threads || [], hand: c.hand || {}, ...(c.canon?.length ? { canon: c.canon } : {}) });
    if (used + block.length + 1 <= room) { blocks.push(block); used += block.length + 1; }
    else omitted.push(name);
  }
  if (omitted.length) blocks.push('Records not shown here, NOT empty: ' + omitted.join(', ')
    + '. Fetch "person: NAME" before changing any unshown field.');
  return blocks.join('\n') || 'No character pages yet.';
}

// Reuse the original-source scratchbook without sending another model out.
// Matching marks exclude receipts for edited/hidden sources. The worker still
// owns chronology and semantic comparison; these are evidence, not new writes.
export function pendingPeopleFacts(state, documents) {
  const originals = new Map(documents.map(d=>[d.id,d]));
  return (state.peopleRecovery || []).filter(f => {
    const d = originals.get(f.source);
    const key = findPersonKey(state.characters,f.name);
    const c = state.characters?.[key];
    return d?.mark === f.mark && quotedSource(d.text,f.shown) && !c?.hand?.core
      && !String(c?.core || '').includes(f.text);
  });
}
export function retainPeopleFailures(state, documents, dropped, resolved = []) {
  const entries = new Map(pendingPeopleFacts(state,documents).map(f=>[f.id,f]));
  for (const r of resolved) {
    if (!r?.why?.trim() || !['held','unsupported','superseded'].includes(r.status)) continue;
    const f = entries.get(r.id);
    if (!f) continue;
    const c = state.characters?.[findPersonKey(state.characters,f.name)];
    if (r.status !== 'held' || c?.core?.trim()) entries.delete(r.id);
  }
  for (const {delta:d,why,recoverable} of dropped) {
    if (!recoverable || d?.field !== 'core' || !d.text || !d.shown) continue;
    const doc = documents.find(doc=>quotedSource(doc.text,d.shown));
    if (!doc || state.characters?.[findPersonKey(state.characters,d.name)]?.hand?.core) continue;
    const id = fingerprint36(JSON.stringify([doc.id,doc.mark,d.name,d.text]));
    entries.set(id,{id,name:d.name,text:d.text,shown:d.shown,source:doc.id,mark:doc.mark,why});
  }
  return [...entries.values()];
}

export function workerProfileSources(state, documents, { material = '', room = 24000 } = {}) {
  if (!Array.isArray(documents)) return '';
  const normalized = text => String(text || '').trim().replace(/\s+/g, ' ').toLowerCase();
  const facts = [...sourceIdentityFacts(state, documents).map(f => ({ ...f, kind: 'identity' })),
    ...sourceAppearanceFacts(state, documents).map(f => ({ ...f, kind: 'appearance' }))]
    .filter(f => {
      if (f.kind === 'identity') {
        const core = state?.characters?.[findPersonKey(state?.characters, f.name)]?.core;
        return !normalized(core).includes(normalized(f.text));
      }
      const entry = state?.canon?.[findCanonKey(state?.canon, f.name)];
      return normalized(findFact(entry, f.key)?.entry?.value) !== normalized(f.value);
    })
    .sort((a, b) => Number(nameOnPage(material, b.name)) - Number(nameOnPage(material, a.name)));
  const lines = []; const omitted = new Set(); let used = 0;
  for (const f of pendingPeopleFacts(state,documents)) {
    const line = 'UNSAVED IDENTITY PROPOSAL, recheck original and current core: ' + JSON.stringify(f);
    if (used + line.length + 1 <= room) { lines.push(line); used += line.length + 1; }
    else omitted.add(f.name);
  }
  if (lines.length) lines.unshift('Repair supported omissions with additive deltas. For a previously unsaved proposal now held, unsupported or superseded, return recoveries:[{id,status,why}] in this same answer. Do not invent facts or replay a rejected mutation blindly.');
  for (const f of facts) {
    const line = JSON.stringify({ name: f.name, kind: f.kind, source: f.source,
      ...(f.kind === 'identity' ? { text: f.text } : { key: f.key, value: f.value }), shown: f.shown });
    if (used + line.length + 1 <= room) { lines.push(line); used += line.length + 1; }
    else omitted.add(f.name);
  }
  if (omitted.size) lines.push('More original facts for: ' + [...omitted].join(', ') + '. Fetch originals with "find: NAME"; do not assume those profiles are complete.');
  return lines.length ? 'ORIGINAL PROFILE FACTS ALREADY RECOVERED. Reconcile missing facts now; keep later developments and manual decisions. These quotations are source evidence, not permission to reset the story.\n' + lines.join('\n') : '';
}

// M711: narrative provenance and current physical state have separate slots.
// Prefer the explicit ending snapshot; never merge an earlier summary into it.
// Flat replies remain compatible with existing providers and saved records.
export function sceneEndingFields(entry) {
  const value=entry?.ending && typeof entry.ending==='object' && !Array.isArray(entry.ending)?entry.ending:entry || {};
  const clean=text=>typeof text==='string' && !/^\s*[-\u2014\u2013]+\s*$/.test(text)?text.trim():'';
  return {position:clean(value.position ?? value.at),attire:clean(value.attire ?? value.wears),
    // Evidence often belongs to the enclosing scene entry. Keep it without
    // allowing any earlier/flat position to leak into the ending snapshot.
    shown:typeof value.shown==='string' && value.shown.trim()?value.shown:typeof entry?.shown==='string'?entry.shown:'',
    evidenceId:value.evidenceId || entry?.evidenceId};
}

// Shared reading procedure, executed inside the existing worker call.
// This is not another auditor or a source-certificate requirement.
export const SCENE_ENDING_TASK = `
DERIVE THE COMPLETED SCENE BEFORE COMPARING WITH THE NOTEBOOK:
Start with the header as opening context, then follow the narration in order. For each person whose position, clothes or physical condition is established or changed, track the actor, recipient and resulting state. Resolve pronouns from the action and viewpoint, not from the nearest proper name. A blow delivered by one person can hurt the other person.
Discard intermediate states replaced later in the sequence. A retreat followed by a stop leaves the person at the stopping point; an outfit removed later is no longer worn. A quiet person's last established state continues while others act. Read the whole scene, not only its final paragraph. People in a separate World Beyond window remain elsewhere.
Only after deriving those ending states compare them with the saved ledger. Earlier wording appearing anywhere on the page does not make it current. Do not invent motion, injury, recovery or a change in feelings. Preserve facts the scene did not change.
Separate sequence from snapshot: optional earlier describes completed movement; ending contains ONLY the final physical state. Position is a short present-state phrase answering where and how they are NOW. The original past-tense sentence belongs in shown as evidence, not in position. Replace a superseded position rather than appending the new stop to the old movement. Paraphrase the current state faithfully; exact source wording is for shown. Do not label unknown clothes with a placeholder. Do not reword a valid equivalent state merely for style.
`;

export const LEDGER_READER_RULES = `
SHARED LEDGER CONTRACT:
Memory retention and active simulation are different. Preserve a real individual's established identity, rank, family and appearance even without a personal name or current presence. A design reference is not a second individual. A temporary participant may have no biography beyond a sourced role; unknown optional facts are not errors. Appearance and newcomer recency alone do not require ongoing World activity. Keep significant family, political, friendship and NPC-to-NPC consequences as explicit open threads or goals, even without feelings toward the main character. Resolve completed obligations before retiring an uninvolved participant. Retirement retains identity, historical relationships, sources and original pages; a returning person reuses them. Never invent current whereabouts from an old sighting.

Identify the SUBJECT before extracting identities or physical facts. A proper name is not proof of a person. Places, kingdoms, organizations and objects are not People unless the original explicitly personifies them as a character. In a title such as "Prince NAME of REALM", NAME is the person and REALM is the place; the person's hair, eyes, age and family never belong to that place. Resolve descriptive clauses and pronouns to their actual subject, not every name appearing in the quotation. Keep animals and other established individual beings as characters. If an existing People record is actually a place/object/organization, classify it explicitly and preserve its misplaced data for correction; never merge a kingdom into a prince as an alias.
Read the whole completed scene, including quiet spectators and the writer's established identities. Follow each person's actions chronologically. Silence is not departure; mentioning a remote person is not presence. Resolve pronouns and titles in context, not by keyword matching.
The opening header is not an ending position. For every physical position select the person's LAST established movement or stopping point, including pronoun actions, then check that no later action changes it. A subsequent paragraph about another person does not move this person. Preserve clothing unless later evidence changes it. Apply this chronology to Scene extraction before saving, not only to the auditor.
The brief supplies explicit starting facts and constraints. Starting feelings and locations can develop through the story unless the writer explicitly locks them. Never reset earned developments to the opening values.
Preserve valid judgments by the responsible worker. Different plausible feelings, motives or offscreen choices are not errors. Correct factual contradictions or explicit rule violations, not personal preferences.
For ordinary People core deltas, supply only missing supported facts; these are additive. Do not rewrite a whole biography to add one relationship. Explicit factual corrections use the existing reviewed correction path.
People core answers WHO the person is: established role/rank, family, background, enduring nature, voice and preferences. An escort assignment or a single action does not replace additional established identity facts. When no additional identity was established, an empty optional core is legitimate. Recover missing established details even when core is nonempty. Lasting physical facts such as hair, eyes, build and scars belong in canon locks (What's true of them); current clothes and pose belong in Scene. Compare both stores with original sources, fetch earlier pages when needed, and never invent an unstated trait or rank. A model-written summary is not a source quotation.
An explicitly stated own persona is the same main character, not an absent NPC. Use mc.alias with the writer's exact identity statement when newly established; all workers share those aliases. Never infer identity from roles or imagined impersonation.
The main character belongs to the writer. Founder and People must record their explicitly written identity and biography from original brief, cast notes or writer pages into core, preserving existing writer facts and quoting the original writer source. This is a factual record, never permission to invent their personality or arc. Scene maintains their physical state and threads. The housekeeper recovers anything missed; do not deliberately leave writer biography for it to repair. Never demand an invented biography to finish an audit.
Scene owns physical presence, posture and event-driven relationship scores. People owns character records and interpretation of character arcs. World owns authorized offscreen simulation and quiet characters' ongoing activity. Keep those views consistent without replaying the same event or overwriting another worker's valid judgment.
For changes retain the cause and supporting quotation when available. Distinguish extracted facts from simulated developments. Retrieve missing evidence rather than inventing history. Unknown whereabouts are not permission to assert an observed location.
Before answering, reconcile your proposed changes with the current ledger and the complete turn. Keep exact established identities, titles and relationships; register an explicitly introduced person even when quiet or absent. Do not erase existing facts to make a shorter record.
`;

/* M750: sharedStoryContext (the Essentials added under each reader's record) is gone with the Essentials — every reader
 * already reads the record itself, handed to it by chat.js. */
