import { fingerprint36 } from '../engine/fingerprint.js';
import { quotedSource } from '../engine/evidence.js';
import { findPersonKey, isMc, mcKey } from '../engine/people.js';
import { ownerAndDependent, samePersonName } from '../engine/names.js';
import { findCanonKey, lookKey } from '../engine/canon.js';

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
      const name = isMc(state,person.name) ? mcKey(state) : findPersonKey(state?.characters,person.name)
        || (!ownerAndDependent(person.name,person.ledgerName || '') && findPersonKey(state?.characters,person.ledgerName)) || person.name;
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
  if (!expected.length) return {ok:true,facts:[]};
  const answers = Array.isArray(checks) ? checks : [];
  if (answers.some(a => !expected.some(f => f.id === a.id))) return {ok:false,why:'appearance check names an unrequested source fact'};
  const key = findCanonKey(state.canon,name);
  const held = state.canon?.[key]?.facts || [];
  const facts = [];
  for (const fact of expected) {
    const matches = answers.filter(a => a.id === fact.id);
    const answer = matches.length === 1 ? matches[0] : null;
    const fail = why => ({ok:false,why:fact.key + ': ' + why + ' (' + fact.source + ')'});
    if (!answer?.why?.trim()) return fail('source fact has not been reconciled');
    if (lookKey(answer.key) !== fact.key) return fail('source fact was assigned to a different field');
    const saved = held.find(f => lookKey(f.key) === fact.key);
    const present = saved && same(saved.value,answer.value);
    let shown = answer.shown || '';
    if (answer.status === 'held') {
      if (!present) return fail('established fact is missing from the saved appearance');
      shown = fact.shown;
    } else if (answer.status === 'manual') {
      const last = [...(state.journal || [])].reverse().find(e => ['canon.lock','canon.unlock'].includes(e.m?.type)
        && samePersonName(e.m.name,name) && lookKey(e.m.key) === fact.key);
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
  return {ok:true,facts};
}
