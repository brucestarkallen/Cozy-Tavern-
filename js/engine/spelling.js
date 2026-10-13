/* Only active editable surfaces. Evidence, journals and receipts stay literal. */
import { renameInState } from '../agents/ripple.js';
export const spellingSettings = ['memory','lore','standingPlans','plans','director','editor']; /* M750: the essentials are retired */
export function activeSpelling(text,state) {
  for (const [from,to] of Object.entries(state?.spellingCorrections || {})) text = spellingReplace(text,from,to);
  return text;
}
export const spellingBooks = ['characters','offscreen','relationships','knowledge','canon','bodies','present','roomAt','threads','factions','sheet','things','duel','battle','worldBrief','worldShown','pendingVerdict','lastVerdict','place'];
export function spellingReplace(text, from, to) {
  if (typeof text !== 'string') return text;
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(?<![\\p{L}\\p{N}_])' + escaped + '(?![\\p{L}\\p{N}_])', 'giu'), to);
}
const fields = (o, keys, replace) => { if (o && typeof o === 'object') for (const k of keys) if (typeof o[k] === 'string') o[k] = replace(o[k]); };
const values = o => Object.values(o || {});
export function spellingState(state, from, to) {
  if (Object.keys(state.characters || {}).filter(k => k.toLowerCase() === from.toLowerCase()).length > 1) throw new Error('More than one record uses the old spelling. Identity resolution is required.');
  const old = Object.keys(state.characters || {}).find(k => k.toLowerCase() === from.toLowerCase());
  const target = Object.keys(state.characters || {}).find(k => k.toLowerCase() === to.toLowerCase());
  if (old && target && old !== target) throw new Error('Two character records already exist. Their identity must be resolved before a spelling correction can safely join them.');
  const next = renameInState(state, from, to, {preserveKnowledge:true,preserveUnrelated:true}).state;
  const r = text => spellingReplace(text, from, to);
  for (const c of values(next.characters)) {
    fields(c, ['core','state','arc','nowAt'], r);
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
    fields(m, ['text','content','voices'], r);
    for (const version of [m,...(m.swipes || [])]) {
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
