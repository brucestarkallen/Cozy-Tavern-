/* Cozy Tavern — assemble/planwords.js (M510)
 * THE PLANNING HELPER'S WORDS, AS THE STORYTELLER HEARS THEM — in the writer's own voice, what he would say across the
 * table before the page, never a form or a third authority (M495). The helper's answer is data (agents/planner.js reads
 * and checks it); these two turn it into his words. Pure. */
import { toTeller } from './voice.js';

const clip = (s, n = 280) => {
  const t = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + '…' : t;
};

/* THE PLAN, IN THE WRITER'S OWN VOICE — what he would say across the table before the page, never a form (M495). The
 * scene's hour, ground and who is here are the LEDGER's own lines at send time (anchor), never the helper's. */
export function renderPlan(plan, { voice = null, anchor = [], cores = {}, mc = '' } = {}) {
  if (!plan) return '';
  const him = mc && mc !== 'the player' ? mc : 'my character';
  /* M510-6: the plan was made BEFORE his move — said so, so the move above governs and the plan never overrides it */
  const out = ['What I have in mind for this page — how things stood before my move above, so it is in front of you.'];
  if (anchor.length) out.push('Right now — ' + anchor.join(' '));
  if (plan.scene) out.push(plan.scene);
  for (const p of plan.people) {
    const core = cores[p.name] ? ' (' + clip(cores[p.name], 140) + ')' : '';
    const bits = [];
    if (p.now) bits.push(p.now.replace(/[.]+$/, ''));
    if (p.wants) bits.push('wants ' + p.wants.replace(/^(?:to\s+)?wants?\s+/i, '').replace(/[.]+$/, ''));
    let line = p.name + core + (bits.length ? ' — ' + bits.join('; ') + '.' : '.');
    /* M510-53: "Set against Jovan: Jovan" said his name twice — what they are set against, only when it is more than him */
    if (p.against) { const what = p.against.replace(/[.]+$/, '').trim(); line += /^(?:him|me)$/i.test(what) || what.toLowerCase() === String(him || '').toLowerCase() ? ' Set against ' + him + ' — and that holds this page.' : ' Set against ' + him + ': ' + what + ' — and that holds this page.'; }
    out.push(line);
  }
  for (const u of plan.unknown) out.push(u.name + ' hasn’t found out: ' + u.fact.replace(/[.]+$/, '') + '.');
  if (plan.pressing.length) out.push('What’s pressing: ' + plan.pressing.map((s) => s.replace(/[.]+$/, '')).join('; ') + '.');
  if (plan.earlier.length) out.push('From earlier, still true: ' + plan.earlier.map((s) => s.replace(/[.]+$/, '')).join('; ') + '.');
  if (plan.leaveTo) out.push('Leave off where ' + him + ' has the next choice — before my move, that looked like: ' + plan.leaveTo.replace(/^(?:at |where )/i, '').replace(/[.]+$/, '') + '. ' + him + '’s choices are mine to make.');
  const text = out.join('\n');
  return voice && voice.teller ? toTeller(text, voice) : text;
}

/* the sound of this page, right before it is written — only for a fight, sex, torture or a raw peak */
export function renderSounds(plan, { voice = null, laws = '', wentQuiet = false } = {}) {
  const out = [];
  if (wentQuiet) out.push('The last page went quiet where it should have been heard — not this one.');
  /* M510-4: "stifled, bitten back, half-escaped" was written back to him as a page of lone "Mmf—" and "Ah—": muffled is
   * said as what it is — the same continuous sound, muffled — and every heated page ends on what each paragraph carries */
  if (plan && plan.loud === false) out.push('This one has to stay muffled' + (plan.loudWhy ? ' — ' + plan.loudWhy.replace(/[.]+$/, '') : '') + ': the sounds are still continuous and still long — muffled, never shortened, never missing.');
  else out.push('This one is loud' + (plan && plan.loudWhy ? ' — ' + plan.loudWhy.replace(/[.]+$/, '') : '') + ': continuous, long, repeated sounds braided through every beat.');
  if (plan && plan.sounds.length) out.push('The sounds here: ' + plan.sounds.join(', ') + '.');
  out.push('Every paragraph: a voiced line that stretches or repeats (never a lone "Ah—"), words or a name breaking through it, and the contact sounds written as sound in asterisks — never described in the narration.');
  const head = out.join(' ');
  const said = voice && voice.teller ? toTeller(head, voice) : head;
  return [said, laws].filter((t) => String(t || '').trim()).join('\n');
}

