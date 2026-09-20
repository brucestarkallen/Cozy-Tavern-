/* Cozy Tavern — js/agents/sensors.js
 * M356: THE SENSORS — the house reads its own story back, and says one thing about it.
 *
 * Every other reader here writes something down (the ledger, the record, the world's word). A sensor writes nothing: it
 * asks a narrow question about the page that just landed and gets a number back. "Does this page match the tone the
 * brief asks for." "Does something go against him here." "Is anything at stake." Averaged over the last few pages, a
 * number like that is a fact about the story's drift that nobody has to notice by hand — and when it dips, the house
 * says ONE short line to the storyteller on the next turn, in the writer's own voice, and then lets it go.
 *
 * It speaks two wires, because the cheapest model for this cannot speak the usual one:
 *   - A DECISIONS house (TypeSafe's Jev, on OpenRouter as typesafe/jev-1.13, or TypeSafe's own /v1/systemone): one POST
 *     of {model, state, questions} and a probability per question back, in about a fifth of a second for a fraction of a
 *     penny. It writes no prose at all — which is exactly what is wanted here.
 *   - ANY ORDINARY MODEL: the same state and the same questions as one worker call, answered as JSON.
 * The questions are the same either way, so what the sensors do never depends on which model is behind them.
 *
 * Laws kept: it never touches the page it read (the writer's page stands); it earns at most ONE line on the next turn,
 * never a list; the line is the writer's voice, not a form; nothing is sent at all with its switch off. */
import { db } from '../store.js';
import { callWorker } from './call.js';
import { houseFetch } from '../providers/relay.js';
import { writerText, wholePage } from '../engine/whole.js';

export const SENSOR_KEY = (storyId) => 'sensors:' + storyId;
export const SENSOR_WINDOW = 4;      /* the last four readings make the average a sensor is judged on */
export const SENSOR_PAGES = 3;       /* how many pages of story ride with the newest one */

/* Each question is a plain proposition about the state, true or false of it — never "is this any good". The floor is
 * where the average has to fall before the house says anything, and the word is what it says, once, in his voice. */
export const SENSORS = [
  {
    id: 'tone',
    name: 'Tone',
    ask: 'The latest page matches the tone, themes and register the brief asks for.',
    floor: 0.45,
    word: 'The last pages have drifted from what this story is meant to feel like — take the tone back to what the brief asks for.',
  },
  {
    id: 'cost',
    name: 'Cost to him',
    ask: 'Something in the latest pages genuinely goes against the main character — a cost, a refusal, a setback — and it is not undone in the same breath.',
    floor: 0.35,
    word: 'Nothing has cost him anything for a while now — let something go against him, and let it stand.',
  },
  {
    id: 'tension',
    name: 'Tension',
    ask: 'Something is at stake in the latest page; it is not an idle scene where nothing can be lost.',
    floor: 0.35,
    word: 'The last pages have gone slack — put something at stake in this one.',
  },
  {
    id: 'world',
    name: 'The world',
    ask: 'The latest page contradicts nothing the story has established about this world and these people.',
    floor: 0.5,
    word: 'Something in the last pages slipped out of the world as we established it — hold to what the story has already made true.',
  },
  {
    id: 'mine',
    name: 'His to play',
    ask: 'The latest page leaves the main character’s own words, thoughts and choices to the writer, and writes only the others.',
    floor: 0.5,
    word: 'Leave him to me — his words and his choices are mine to write.',
  },
];
export const sensorById = (id) => SENSORS.find((s) => s.id === id) || null;

/* Which wire this connection speaks. A decisions house is named by its address (OpenRouter's alpha endpoint, TypeSafe's
 * own) or by its model (the Jev family); everything else is an ordinary model, asked for JSON. */
export function sensorShape(conn) {
  const url = String((conn && conn.baseUrl) || '').toLowerCase();
  const model = String((conn && conn.model) || '').toLowerCase();
  if (/\/(?:decisions|systemone)\b/.test(url) || /\bjev\b|jev-/.test(model)) return 'decisions';
  return 'chat';
}
export function decisionsUrl(conn) {
  const base = String((conn && conn.baseUrl) || '').trim().replace(/\/+$/, '');
  if (/\/(?:decisions|systemone)$/.test(base)) return base;
  if (/openrouter\.ai/.test(base)) return base.replace(/\/api$/, '') + '/api/alpha/decisions';
  if (/typesafe\.ai/.test(base)) return base.replace(/\/v1$/, '') + '/v1/systemone';
  return base + '/v1/systemone';
}

/* what a careful reader would look at: the brief, the pages before it, and the page that just landed */
export function sensorState({ brief = '', castNotes = '', pages = [], newest = '', mc = '' } = {}) {
  const before = (Array.isArray(pages) ? pages : []).slice(-SENSOR_PAGES).map((p) => wholePage(String(p || ''), 2500));
  return {
    brief: writerText(brief, 4000, 'brief'),
    ...(String(castNotes || '').trim() ? { cast_notes: writerText(castNotes, 1500, 'cast notes') } : {}),
    ...(mc && mc !== 'the player' ? { player: mc } : {}),
    story_so_far: before,
    latest_page: wholePage(String(newest || ''), 6000),
  };
}

export function decisionsBody(conn, state, sensors = SENSORS) {
  const questions = {};
  for (const s of sensors) questions[s.id] = { type: 'noul', instructions: s.ask };
  return { model: String((conn && conn.model) || 'typesafe/jev-1.13'), state, questions };
}

const CHAT_SYSTEM = [
  'You judge a page of a story against plain statements about it. For each statement you answer with one number between 0 and 1: the chance the statement is TRUE of the state you were given (1 certainly true, 0 certainly false).',
  'You never write prose, never explain, and never judge whether the writing is good — only whether each statement is true.',
  'Answer with one raw JSON object and nothing else: every key is a statement’s name, every value a number between 0 and 1. No prose, no markdown, no code fences.',
].join('\n');

export function chatAsk(state, sensors = SENSORS) {
  const lines = sensors.map((s) => '"' + s.id + '": ' + s.ask);
  return {
    system: CHAT_SYSTEM,
    user: ['<state>', JSON.stringify(state, null, 1), '</state>', '', 'The statements:', ...lines, '', 'Answer: {' + sensors.map((s) => '"' + s.id + '": 0.0').join(', ') + '}'].join('\n'),
  };
}

const clamp01 = (n) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : null);
/* both houses' answers, read the same way */
export function readAnswers(raw, shape, sensors = SENSORS) {
  const out = {};
  let said = raw;
  if (typeof raw === 'string') {
    const at = raw.indexOf('{');
    const to = raw.lastIndexOf('}');
    try { said = at >= 0 && to > at ? JSON.parse(raw.slice(at, to + 1)) : null; } catch (err) { said = null; }
  }
  if (!said || typeof said !== 'object') return out;
  const answers = shape === 'decisions' ? (said.answers && typeof said.answers === 'object' ? said.answers : {}) : said;
  for (const s of sensors) {
    const got = answers[s.id];
    const n = got && typeof got === 'object' ? clamp01(Number(got.noul ?? got.score ?? got.probability)) : clamp01(Number(got));
    if (n !== null) out[s.id] = n;
  }
  return out;
}

/* the last few readings of each sensor, and their average */
export function foldReadings(kept, scores) {
  const out = {};
  const was = kept && typeof kept === 'object' ? kept : {};
  for (const s of SENSORS) {
    const list = Array.isArray(was[s.id]) ? was[s.id].filter((n) => Number.isFinite(n)) : [];
    if (Number.isFinite(scores[s.id])) list.push(scores[s.id]);
    if (list.length) out[s.id] = list.slice(-SENSOR_WINDOW);
  }
  return out;
}
export function averages(kept) {
  const out = {};
  for (const [id, list] of Object.entries(kept || {})) {
    if (!Array.isArray(list) || !list.length) continue;
    out[id] = list.reduce((a, b) => a + b, 0) / list.length;
  }
  return out;
}

/* ONE line, the sensor that has fallen furthest below its floor — never a list, never a nag: a sensor that has just
 * spoken is quiet until its average climbs back over its floor. */
export function dueWord(kept, spoken = {}) {
  const avg = averages(kept);
  let worst = null;
  for (const s of SENSORS) {
    const a = avg[s.id];
    if (!Number.isFinite(a) || !Array.isArray(kept[s.id]) || kept[s.id].length < 2) continue;
    if (a >= s.floor) continue;
    if (spoken[s.id] === true) continue;
    const under = s.floor - a;
    if (!worst || under > worst.under) worst = { id: s.id, under, word: s.word };
  }
  return worst ? { id: worst.id, word: worst.word } : null;
}
/* which sensors are quiet again (back over their floor), so the same word can be earned later */
export function stillSpoken(kept, spoken = {}) {
  const avg = averages(kept);
  const out = {};
  for (const [id, was] of Object.entries(spoken || {})) {
    const s = sensorById(id);
    if (was === true && s && Number.isFinite(avg[id]) && avg[id] < s.floor) out[id] = true;
  }
  return out;
}

export async function loadSensors(storyId) {
  try {
    const kept = await db.settings.get(SENSOR_KEY(storyId));
    return kept && typeof kept === 'object' ? kept : { readings: {}, spoken: {}, word: '', wordFrom: '' };
  } catch (err) {
    return { readings: {}, spoken: {}, word: '', wordFrom: '' };
  }
}
export async function saveSensors(storyId, kept) {
  try { await db.settings.set(SENSOR_KEY(storyId), kept); } catch (err) { /* a reading is never worth a thrown turn */ }
}

/* The reading itself. Background only, never on the way to a page, and it never throws. */
export async function readSensors({ connection, storyId, brief = '', castNotes = '', pages = [], newest = '', mc = '', signal, callLLM } = {}) {
  try {
    if (!connection || !storyId || !String(newest || '').trim()) return null;
    const shape = sensorShape(connection);
    const state = sensorState({ brief, castNotes, pages, newest, mc });
    let raw = '';
    if (typeof callLLM === 'function') {
      raw = await callLLM({ shape, state, body: shape === 'decisions' ? decisionsBody(connection, state) : chatAsk(state) });
    } else if (shape === 'decisions') {
      const res = await houseFetch(decisionsUrl(connection), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(connection.apiKey ? { authorization: 'Bearer ' + connection.apiKey } : {}) },
        body: JSON.stringify(decisionsBody(connection, state)),
        signal,
      }, connection);
      if (!res || !res.ok) return null;
      raw = await res.json();
    } else {
      const ask = chatAsk(state);
      const { text } = await callWorker(connection, { system: ask.system, user: ask.user, maxTokens: 400, signal });
      raw = text || '';
    }
    const scores = readAnswers(raw, shape);
    if (!Object.keys(scores).length) return null;
    const kept = await loadSensors(storyId);
    const readings = foldReadings(kept.readings, scores);
    const spoken = stillSpoken(readings, kept.spoken);
    const due = dueWord(readings, spoken);
    const next = { readings, spoken, word: due ? due.word : '', wordFrom: due ? due.id : '' };
    await saveSensors(storyId, next);
    return { scores, readings, averages: averages(readings), word: next.word, wordFrom: next.wordFrom };
  } catch (err) {
    return null;
  }
}

/* what the storyteller is told this turn — once, then let go */
export async function takeSensorWord(storyId) {
  const kept = await loadSensors(storyId);
  const word = typeof kept.word === 'string' ? kept.word : '';
  if (!word) return '';
  const spoken = { ...(kept.spoken || {}) };
  if (kept.wordFrom) spoken[kept.wordFrom] = true;
  await saveSensors(storyId, { ...kept, word: '', wordFrom: '', spoken });
  return word;
}

/* for the drawer's line of workers: "tone .81 · cost .22 · tension .40" */
export function sensorLine(kept) {
  const avg = averages((kept && kept.readings) || {});
  const bits = SENSORS.filter((s) => Number.isFinite(avg[s.id])).map((s) => s.name.toLowerCase() + ' ' + avg[s.id].toFixed(2).replace(/^0/, ''));
  return bits.join(' · ');
}
