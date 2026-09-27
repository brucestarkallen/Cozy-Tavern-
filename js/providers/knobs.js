/* Cozy Tavern — providers/knobs.js (M510)
 * THE REST OF THE SAMPLING DIALS. An open model's house (vLLM, SGLang, llama.cpp, OpenRouter, hemmingway.io…) takes more
 * than temperature and top-p: top-k, min-p, the three repetition penalties, stop texts and a seed. Each is sent only
 * when the writer filled it in (his law: a value set is sent, nothing set sends nothing — the provider's own default
 * rules). A house that refuses one names it; that one dial is left out from then on through the same memory the
 * thinking fields use (effort.js learnFact → learnedDrop), and the rest still ride. Pure. */
export const KNOBS = [
  ['topK', 'top_k'],
  ['minP', 'min_p'],
  ['presencePenalty', 'presence_penalty'],
  ['frequencyPenalty', 'frequency_penalty'],
  ['repetitionPenalty', 'repetition_penalty'],
  ['stop', 'stop'],
  ['seed', 'seed'],
];
export const KNOB_FIELDS = KNOBS.map(([, field]) => field);

/* What a worker's JSON never rides with — the one override his law allows, a floor against corruption: a penalty
 * pushes a model off the quotes and keys it has already written, and a stop text can end an answer mid-object. */
export const WORKER_UNSAFE = ['presencePenalty', 'frequencyPenalty', 'repetitionPenalty', 'stop'];

/* the dials a connection sets, spelled the way the wire spells them */
export function knobsOf(conn) {
  const c = conn && typeof conn === 'object' ? conn : {};
  const out = {};
  for (const [key, field] of KNOBS) {
    const v = c[key];
    if (key === 'stop') {
      const list = Array.isArray(v) ? v.filter((s) => typeof s === 'string' && s !== '') : [];
      if (list.length) out.stop = list;
      continue;
    }
    if (typeof v === 'number' && Number.isFinite(v)) out[field] = key === 'topK' || key === 'seed' ? Math.round(v) : v;
  }
  return out;
}

/* Which of the dials sent a refusal names — the field beside the house's own words for "not taken", in one sentence
 * ("Unrecognized request argument supplied: min_p", "Extra inputs are not permitted: repetition_penalty", "top_k is
 * not supported"). One dial named, or '' — never a guess. */
const NOT_TAKEN = '(?:unrecognized|unknown|unsupported|not supported|extra (?:inputs?|fields?|arguments?)|not permitted|not allowed|unexpected|invalid (?:parameter|field|argument|key)|no such|does not support|doesn.t support|is not a valid)';
export function knobRefused(detail, sent = []) {
  const text = String(detail || '');
  for (const f of Array.isArray(sent) ? sent : []) {
    const near = new RegExp(NOT_TAKEN + '[^.]{0,80}?[\\s"\'`:(\\[]' + f + '(?![A-Za-z0-9_])|(?:^|[\\s"\'`(\\[])' + f + '(?![A-Za-z0-9_])[^.]{0,80}?' + NOT_TAKEN, 'i');
    if (near.test(text)) return f;
  }
  return '';
}
