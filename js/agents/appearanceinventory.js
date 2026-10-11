import { fingerprint36 } from '../engine/fingerprint.js';
import { quotedSource } from '../engine/evidence.js';
import { isMc, mcKey } from '../engine/people.js';
import { samePersonName } from '../engine/names.js';
import { findCanonKey, lookKey } from '../engine/canon.js';
import { sourcePersonKey } from './auditsources.js';

// Source reading proposes facts. The housekeeper decides their meaning and
// chronology; the transport makes omissions visible without parsing prose.
export function sourceAppearanceFacts(state, documents = null) {
  const sources = documents && new Map(documents.map(d => [d.id,d]));
  const facts = new Map();
  for (const [source, receipt] of Object.entries(state?.auditSources || {})) {
    const original = sources?.get(source);
    if (sources && (!original || original.mark !== receipt.mark)) continue;
    if (receipt.appearanceReviewed !== true) continue;
    for (const person of receipt.people || []) {
      if (person.kind && person.kind !== 'person') continue;
      const resolved = sourcePersonKey(state,person.name,person.ledgerName) || person.name;
      const name = isMc(state,resolved) ? mcKey(state) : resolved;
      for (const fact of person.facts || []) {
        if (!fact.key || !fact.value || !fact.shown || (original && !quotedSource(original.text,fact.shown))) continue;
        const id = 'appearance:' + fingerprint36(JSON.stringify([name,lookKey(fact.key),fact.value.trim().replace(/\s+/g,' ').toLowerCase()]));
        const prior = facts.get(id);
        if (prior) { if (!prior.references.includes(source)) prior.references.push(source); }
        else facts.set(id,{id,name,key:lookKey(fact.key),value:fact.value,shown:fact.shown,source,references:[source]});
      }
    }
  }
  return [...facts.values()];
}

const same = (a,b) => String(a ?? '').trim().replace(/\s+/g,' ').toLowerCase() === String(b ?? '').trim().replace(/\s+/g,' ').toLowerCase();
export function reconcileAppearance(state, name, expected, checks, documents) {
  if (!expected.length) return {ok:true,facts:[],answers:[]};
  const answers = Array.isArray(checks) ? checks : [];
  if (answers.some(a => !expected.some(f => f.id === a.id))) return {ok:false,why:'appearance check names an unrequested source fact'};
  const key = findCanonKey(state.canon,name);
  const held = state.canon?.[key]?.facts || [];
  const facts = [];
  const reconciled=[];
  for (const fact of expected) {
    const matches = answers.filter(a => a.id === fact.id);
    let answer = matches.length === 1 ? matches[0] : null;
    // Exact saved data needs no redundant model echo. Differently worded or
    // persona-specific mappings still belong to an explicit housekeeper verdict.
    if (!matches.length) {
      const exact = held.find(f => lookKey(f.key) === fact.key && same(f.value,fact.value));
      if (exact) answer = {id:fact.id,status:'held',key:exact.key,value:exact.value,why:'The exact source fact is already saved.'};
    }
    const fail = why => ({ok:false,why:fact.key + ': ' + why + ' (' + fact.source + ')'});
    if (!answer?.why?.trim()) return fail('source fact has not been reconciled');
    reconciled.push(answer);
    if (!String(answer.key || '').trim()) return fail('source fact has no saved field');
    const savedKey = lookKey(answer.key);
    const saved = held.find(f => lookKey(f.key) === savedKey);
    const present = saved && same(saved.value,answer.value);
    let shown = answer.shown || '';
    if (answer.status === 'held') {
      if (!present) return fail('established fact is missing from the saved appearance');
      shown = fact.shown;
    } else if (answer.status === 'manual') {
      const last = [...(state.journal || [])].reverse().find(e => ['canon.lock','canon.unlock'].includes(e.m?.type)
        && samePersonName(e.m.name,name) && lookKey(e.m.key) === savedKey);
      if (!last?.m?.byHand || (last.m.type === 'canon.unlock' ? Boolean(saved) : !present)) return fail('no matching current manual decision');
      if (!saved) continue;
      shown = fact.shown;
    } else if (['superseded','ended'].includes(answer.status)) {
      if (answer.evidenceError || !shown || !documents.some(d => quotedSource(d.text,shown))) return fail('later correction needs original evidence');
      if (answer.status === 'superseded' ? !present : Boolean(saved)) return fail('the saved appearance does not match the resolution');
      if (answer.status === 'ended') continue;
    } else return fail('source fact remains open');
    facts.push({key:saved.key,value:saved.value,shown});
  }
  return {ok:true,facts,answers:reconciled};
}

export function sourceIdentityFacts(state, documents = null) {
  const sources = documents && new Map(documents.map(d=>[d.id,d]));
  const facts = new Map();
  for (const [source,receipt] of Object.entries(state?.auditSources || {})) {
    const original=sources?.get(source);
    if (sources && (!original || original.mark!==receipt.mark)) continue;
    for (const person of receipt.people || []) {
      if (person.kind && person.kind !== 'person') continue;
      const resolved=sourcePersonKey(state,person.name,person.ledgerName) || person.name;
      const name=isMc(state,resolved)?mcKey(state):resolved;
      for (const fact of person.identityFacts || []) {
        if (!fact.text || !fact.shown || (original && !quotedSource(original.text,fact.shown))) continue;
        const id='identity:'+fingerprint36(JSON.stringify([name,fact.text.trim().replace(/\s+/g,' ').toLowerCase()]));
        if (!facts.has(id)) facts.set(id,{id,name,text:fact.text,shown:fact.shown,source});
      }
    }
  }
  return [...facts.values()];
}

export function reconcileIdentity(state,name,expected,checks,documents) {
  const core=String(state.characters?.[name]?.core || '');
  const answers=Array.isArray(checks)?checks:[];
  if (answers.some(a=>!expected.some(f=>f.id===a.id))) return {ok:false,why:'identity check names an unrequested source fact'};
  for (const fact of expected) {
    const matches=answers.filter(a=>a.id===fact.id);
    if (!matches.length && same(core, fact.text)) continue;
    if (!matches.length && core.toLowerCase().includes(fact.text.toLowerCase())) continue;
    const a=matches.length===1?matches[0]:null;
    if (!a?.why?.trim()) return {ok:false,why:'writer identity fact has not been reconciled ('+fact.source+')'};
    const represented=a.coreText?.trim() && core.replace(/\s+/g,' ').includes(a.coreText.trim().replace(/\s+/g,' '));
    if (a.status==='held' && represented) continue;
    if (a.status==='manual' && state.characters?.[name]?.hand?.core) continue;
    if (a.status==='superseded' && represented
      && !a.evidenceError && documents.some(d=>quotedSource(d.text,a.shown))) continue;
    return {ok:false,why:'writer identity fact is not represented in the saved core ('+fact.source+')'};
  }
  return {ok:true};
}
