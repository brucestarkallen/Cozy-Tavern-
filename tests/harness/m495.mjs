/* M495 — every side voice speaks as the writer's own notes: the storyteller never reads a third authority's orders. */
import './idb-shim.mjs';
import { test, assert } from './lib.mjs';
import { buildRequest } from '../../js/assemble/stack.js';
import { renderDirectorNote } from '../../js/agents/director.js';
import { renderEditorNote } from '../../js/agents/editor.js';
import { houseEyeWords } from '../../js/agents/lint.js';
import { emptyState } from '../../js/engine/state.js';

test('M495 the whole wire with every side voice filled — director, editor, the eye, the ruling, the world, canon, the sensors — carries no persona-breaking word; the director and editor speak as his plan and his notes', () => {
  const s = emptyState(); s.sheet = { actors: {}, playerName: 'Jovan Arden' };
  const r = buildRequest({ story: { title: 't', brief: 'A DC and Marvel world.', castNotes: '' }, messages: [{ id: 'u1', role: 'user', text: 'I sit.' }, { id: 'a1', role: 'assistant', text: '[X — Monday | 09:00 | sun | coat | here] Kara waits.' }, { id: 'u2', role: 'user', text: 'I look at her.' }],
    settings: { tellerName: 'Tony Stark', writerName: 'Bruce', refereeOn: true }, state: s, modules: [], memory: '', cast: [], lore: '', loreFired: [], window: { mode: 'keeper', window: 30, budgetTokens: 400000 },
    directorNote: renderDirectorNote({ episode: 2, text: 'PREMISE — Kara stays.\nBEATS — Vivi calls.\nNPC & WORLD INITIATIVE — Dev hunts.\nLANDING — she stays.' }),
    editorEye: renderEditorNote({ enabled: true, critique: { northStar: 'Keep it close.', notes: ['Let Kara drive one beat.'] } }),
    houseEye: houseEyeWords([{ kind: 'craft', severity: 'warn', words: 'A dead phrase is on the page.', law: 'Dead Phrases' }]),
    ruling: 'Kara lets him close.', worldBrief: 'Dev Okafor is two towers off.', canonNote: 'What canon says.\nKara Zor-El:\n  Superman’s cousin.', canonOn: true, sensorNote: 'The owl ring was on the news.' });
  const wire = [...(r.systemBlocks || []).map((b) => (typeof b === 'string' ? b : b.text)), ...r.messages.map((m) => String(m.content))].join('\n');
  const bad = wire.match(/\b(assistant|an AI|language model|LLM|system prompt|the system|worker|JSON|mutation|marching orders|NORTH STAR|PREMISE —|BEATS —|NPC & WORLD|the director|the editor|the auditor|the referee|the house)\b/gi);
  assert(!bad, 'persona-breaking words on the wire: ' + JSON.stringify(bad));
  assert(/Episode 2 — where I want this episode to go/.test(wire) && /What it is about: Kara stays\./.test(wire), 'the director is his plan');
  assert(/My notes on the telling/.test(wire) && /What matters most right now: Keep it close\./.test(wire) && /- Let Kara drive one beat\./.test(wire), 'the editor is his notes');
  assert(/\[EPISODE_END\]/.test(wire), 'the episode mark the director needs still rides');
});
