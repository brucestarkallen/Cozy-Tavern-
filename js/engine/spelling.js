/* Only active editable surfaces. Evidence, journals and receipts stay literal. */
import { renameInState, replaceOutside } from '../agents/ripple.js';
export const spellingSettings = ['memory','lore','standingPlans','plans','director','editor']; /* M750: the essentials are retired */
export function activeSpelling(text,state) {
  for (const [from,to] of Object.entries(state?.spellingCorrections || {})) text = spellingReplace(text,from,to);
  return text;
}
export const spellingBooks = ['characters','offscreen','relationships','knowledge','canon','bodies','present','roomAt','threads','factions','sheet','things','duel','battle','worldBrief','worldShown','pendingVerdict','lastVerdict','place'];
/* M752: THE NAME AS A NAME. A correction matched its old spelling in any case: May to Mae rewrote "you may go", "the
 * first of May" and every "may" the readers wrote into the ledger after it. The old spelling is matched as a whole word,
 * as the correction writes it (Aakeno) or in capitals (AAKENO, corrected in capitals: AKENO); a word in another case is
 * not the name. An occurrence inside the corrected form ("Renji" in "Renji Abarai") is the correction already, so a second
 * pass, a replay or a fold changes nothing. A name that is also an ordinary word is refused (spellingOrdinaryUse). */
const nameRe = (form) => new RegExp('(?<![\\p{L}\\p{N}_])' + form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![\\p{L}\\p{N}_])', 'gu');
export function spellingReplace(text, from, to) {
  if (typeof text !== 'string' || typeof from !== 'string' || !from || typeof to !== 'string') return text;
  const forms = [[from, to]];
  if (from.toUpperCase() !== from) forms.push([from.toUpperCase(), to.toUpperCase()]);
  for (const [wrong, right] of forms) text = replaceOutside(text, nameRe(wrong), right, nameRe(right));
  return text;
}
/* M752: AN ORDINARY WORD IS NOT CORRECTED STORY-WIDE. No rule of case or place tells "May said" from "May I" or "the first
 * of May", so a correction whose old spelling is also an ordinary word of this tale is refused before anything changes,
 * with the reason. It is one when the tale's own text writes it in lower case — a storyteller's page, the record, the
 * brief, the cast notes or the lore's text (a name is written capitalised there; his chat lines are no evidence, he may
 * type a name in lower case) — when it names a month or a weekday (the clock reads those in every header), or when the
 * correction itself gives it in lower case. Returns the reason, or ''. */
const CALENDAR_WORDS = { month: ['january','february','march','april','may','june','july','august','september','october','november','december','jan','feb','mar','apr','jun','jul','aug','sep','sept','oct','nov','dec'],
  'day of the week': ['monday','tuesday','wednesday','thursday','friday','saturday','sunday','mon','tue','tues','wed','weds','thu','thur','thurs','fri','sat','sun'] };
export function spellingOrdinaryUse(view, from) {
  const name = String(from || '').trim(), low = name.toLowerCase();
  if (!name) return '';
  const instead = ' Nothing was changed. Correct the pages where it is the name one by one instead.';
  for (const [kind, words] of Object.entries(CALENDAR_WORDS)) if (words.includes(low)) return '“' + name + '” is also the name of a ' + kind + ', so one story-wide change cannot tell the name from the ' + kind + '.' + instead;
  if (name === low && low !== name.toUpperCase()) return '“' + name + '” is written in lower case, the way an ordinary word is. Nothing was changed. Name the old spelling as the story writes the name, capitalised.';
  if (name === low) return ''; /* a script without capitals: the name has no other form */
  const word = nameRe(low);
  const texts = [];
  for (const m of view?.messages || []) if (m && m.role === 'assistant') for (const version of [m, ...(Array.isArray(m.swipes) ? m.swipes : [])]) for (const key of ['text','content']) texts.push(['', version?.[key]]);
  for (const n of view?.settings?.memory?.nodes || []) for (const key of ['text','detail']) texts.push(['the record: ', n?.[key]]);
  texts.push(['the brief: ', view?.story?.brief], ['the cast notes: ', view?.story?.castNotes]);
  for (const e of Array.isArray(view?.settings?.lore) ? view.settings.lore : []) texts.push(['the lore: ', e?.content]);
  for (const [where, text] of texts) {
    const at = typeof text === 'string' ? text.search(word) : -1;
    if (at >= 0) return '“' + name + '” is also an ordinary word in this story (' + where + '“…' + text.slice(Math.max(0, at - 40), at + low.length + 40).replace(/\s+/g, ' ').trim() + '…”), so one story-wide change cannot tell the name from the word.' + instead;
  }
  return '';
}
const fields = (o, keys, replace) => { if (o && typeof o === 'object') for (const k of keys) if (typeof o[k] === 'string') o[k] = replace(o[k]); };
const values = o => Object.values(o || {});
export function spellingState(state, from, to) {
  if (Object.keys(state.characters || {}).filter(k => k.toLowerCase() === from.toLowerCase()).length > 1) throw new Error('More than one record uses the old spelling. Identity resolution is required.');
  const old = Object.keys(state.characters || {}).find(k => k.toLowerCase() === from.toLowerCase());
  const target = Object.keys(state.characters || {}).find(k => k.toLowerCase() === to.toLowerCase());
  if (old && target && old !== target) throw new Error('Two character records already exist. Their identity must be resolved before a spelling correction can safely join them.');
  const next = renameInState(state, from, to, {preserveKnowledge:true,preserveUnrelated:true,text:false}).state; /* M752: keys and name slots there; every text once, below */
  const r = text => spellingReplace(text, from, to);
  for (const c of values(next.characters)) {
    // M752: a writer-proven core stays proven through the correction (its proof text follows the same rewrite);
    // coreOrigin.shown keeps the literal original quotation.
    const proven = c.coreOrigin && typeof c.coreOrigin === 'object' && typeof c.core === 'string' && c.coreOrigin.text === c.core;
    fields(c, ['core','state','arc','nowAt'], r);
    if (proven && c.coreOrigin.text !== c.core) c.coreOrigin = {...c.coreOrigin, text: c.core};
    if (Array.isArray(c.threads)) c.threads = c.threads.map(r);
    if (Array.isArray(c.aliases)) c.aliases = c.aliases.filter(a => typeof a !== 'string' || a.toLowerCase() !== from.toLowerCase()).map(r);
  }
  for (const p of next.present || []) fields(p, ['name','position','attire'], r);
  fields(next.place, ['name'], r);
  for (const o of values(next.offscreen)) fields(o, ['location','activity','agenda','toward','with'], r);
  for (const o of values(next.relationships)) fields(o, ['note','stance','toward'], r);
  for (const list of values(next.knowledge)) for (const o of list || []) fields(o, ['fact'], r);
  for (const o of values(next.canon)) for (const f of o.facts || []) fields(f, ['key','value'], r);
  for (const o of values(next.bodies)) for (const f of [...(o.injuries || []), ...(o.strain || [])]) fields(f, ['what','where','note'], r);
  for (const o of next.threads || []) fields(o, ['title','owner','next'], r);
  for (const o of values(next.factions)) fields(o, ['stance','agenda','move'], r);
  for (const o of values(next.things)) fields(o, ['owner','where','note'], r);
  fields(next.worldBrief, ['pressure','ripe','twb'], r);
  fields(next.worldBrief?.twb,['who','where','changed'],r);
  for (const voice of next.worldBrief?.voices || []) fields(voice,['speaker','channel','content'],r);
  for (const k of ['pressure','ripe']) if (Array.isArray(next.worldBrief?.[k])) next.worldBrief[k] = next.worldBrief[k].map(r);
  for (const o of next.worldShown || []) fields(o, ['who','where','changed','twb'], r);
  for (const o of [next.pendingVerdict, next.lastVerdict]) fields(o, ['words','directive'], r);
  const live = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(live); return; }
    fields(o, ['name','who','owner','target','attacker','defender','playerName','enemyCommander','victor','note','condition','words','directive'], r);
    for (const k of ['player','opp']) live(o[k]);
    for (const k of ['actors','sides','teams','members','fighters','conditions','participants','allies','enemies']) {
      if (Array.isArray(o[k])) o[k] = o[k].map(x => typeof x === 'string' ? r(x) : (live(x), x));
      else if (o[k] && typeof o[k] === 'object') values(o[k]).forEach(live);
    }
  };
  [next.sheet,next.duel,next.battle].forEach(live);
  if (Array.isArray(next.sheet?.playerAliases)) next.sheet.playerAliases = next.sheet.playerAliases.filter(a=>typeof a !== 'string' || a.toLowerCase() !== from.toLowerCase()).map(r);
  return next;
}
export function spellingContent(snapshot, from, to) {
  const next = structuredClone(snapshot), r = text => spellingReplace(text, from, to);
  fields(next.story, ['title','brief','castNotes'], r);
  for (const m of next.messages) {
    if (!['assistant','user'].includes(m.role) || m.ooc) continue;
    for (const version of [m,...(m.swipes || [])]) { /* M752: each version once (the shown one was rewritten twice) */
      fields(version,['text','content','voices'],r);
      for (const voice of Array.isArray(version.voices) ? version.voices : []) fields(voice,['speaker','channel','content'],r);
    }
  }
  for (const n of next.settings.memory?.nodes || []) fields(n, ['text','detail'], r);
  fields(next.settings.director,['text'],r);
  fields(next.settings.editor?.critique,['northStar'],r);
  if (Array.isArray(next.settings.editor?.critique?.notes)) next.settings.editor.critique.notes = next.settings.editor.critique.notes.map(r);
  for (const p of next.settings.standingPlans?.plans || []) {
    fields(p,['title','by','goal','outcome'],r);
    for (const part of p.parts || []) fields(part,['who','does','when'],r);
    if (Array.isArray(p.words)) p.words = p.words.map(r);
  }
  for (const entry of values(next.settings.plans?.plans)) {
    const p = entry.plan;
    fields(p,['story','scene','loudWhy','leaveTo'],r);
    for (const person of p?.people || []) fields(person,['name','now','wants','against','voice','pressed'],r);
    for (const person of p?.unknown || []) fields(person,['name','fact'],r);
    for (const k of ['pressing','earlier','sounds']) if (Array.isArray(p?.[k])) p[k] = p[k].map(r);
  }
  for (const e of next.settings.lore || []) {
    fields(e, ['name','content'], r);
    for (const key of ['keys','secondaryKeys']) if (Array.isArray(e[key])) e[key] = e[key].map(r);
  }
  return next;
}
export function restoreSpelling(current, before, after, path = 'story') {
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  if (same(before,after)) return current;
  if (same(current,after)) return structuredClone(before);
  if (Array.isArray(current) && Array.isArray(before) && Array.isArray(after) && before.length === after.length && current.length >= after.length) {
    const out = current.slice();
    for (let i=0;i<after.length;i++) {
      const at = after[i]?.id ? current.findIndex(v=>v?.id===after[i].id) : i;
      if (at < 0) throw new Error('Not taken back: a corrected entry is missing from ' + path);
      out[at] = restoreSpelling(current[at],before[i],after[i],path + '[' + i + ']');
    }
    return out;
  }
  if (current && before && after && !Array.isArray(current) && typeof current === 'object' && typeof before === 'object' && typeof after === 'object') {
    const out = {...current};
    for (const k of new Set([...Object.keys(before),...Object.keys(after)])) {
      const v = restoreSpelling(current[k],before[k],after[k],path + '.' + k);
      if (v === undefined) delete out[k]; else out[k] = v;
    }
    return out;
  }
  throw new Error('Not taken back: ' + path + ' changed after the correction.');
}
/* M752: THE RECEIPT KEEPS THE LEDGER'S HALF. The ledger's take-back of a correction lived only in its log line, and the log
 * keeps its newest 200 lines: some sixty pages on, the Housekeeper's undo refused the whole correction ("The ledger undo
 * receipt is no longer available") while its receipt still held the pages, the record and the lore — and the card still
 * said it could be undone. The receipt keeps the ledger's half as well: what the correction changed there, and only that.
 * A part equal before and after is left out; restoreSpelling reads a part left out exactly as it read an equal one. */
const plainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
function changedParts(before, after) {
  if (!plainObject(before) || !plainObject(after)) return [before, after];
  const b = {}, a = {};
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[k]) === JSON.stringify(after[k])) continue;
    const [x, y] = changedParts(before[k], after[k]);
    if (x !== undefined) b[k] = x;
    if (y !== undefined) a[k] = y;
  }
  return [b, a];
}
export function spellingLedgerReceipt(line) {
  const undo = line && line.undo;
  if (!undo || undo.kind !== 'people.renamed' || !undo.after || !Number.isInteger(line.jid)) return null;
  const [before, after] = changedParts(undo.before || {}, undo.after);
  return { jid: line.jid, words: line.words, undo: { kind: 'people.renamed', coordinated: true, before, after } };
}

// Read-only verification also catches unknown active ledger fields. They are
// reported, never blindly rewritten. Provenance has its own literal lifetime.
export function remainingLedgerSpellings(state,from,to) {
  const remaining = [], evidence = new Set(['history','coreOrigin','sourceRefs','source','evidence','shown','quote','original','receipt','undo','log','journal','hand','snapshot','snap','identityResolution']);
  const visit = (value,path) => {
    if (typeof value === 'string') { if (spellingReplace(value,from,to) !== value) remaining.push(path); return; }
    if (!value || typeof value !== 'object') return;
    for (const [key,child] of Object.entries(value)) {
      if (evidence.has(key)) continue;
      if (spellingReplace(key,from,to) !== key) remaining.push(path + '.' + key);
      visit(child,path + '.' + key);
    }
  };
  for (const key of spellingBooks) visit(state[key],'ledger.' + key);
  return remaining;
}
