/* Cozy Tavern — agents/director.js
 * The director (M10): the showrunner who keeps an episode moving. Per
 * story it holds one directive — the marching orders the storyteller reads
 * in the dynamic tail ("The director's note" on the receipt) — and a small
 * state: {text, episode, concluded, auto}.
 *
 * Modes: new (the first episode) / next (close this one, open the next) /
 * seed (a directive grown from the writer's own line) / edit (hand-edit
 * the text, no model) / restart (clear the board). Auto mode: when it's on
 * and no directive is active, the director writes the next one on its own
 * — in the background, never on the story-generation path.
 *
 * A directive is written in three passes, each skippable:
 *   1. draft      — the director sketches the episode
 *   2. polish     — the showrunner tightens it (skip with skipPolish)
 *   3. watcher    — the watcher checks it against the format law and may
 *                   hand back a revised text (skip with skipWatch)
 *
 * The format law: PREMISE + QUESTION; 3–5 motive-anchored beats (one from
 * outside the cast, one that turns the middle, a final dilemma, one light
 * B-beat); NPC & WORLD INITIATIVE; a LANDING where every branch reprices a
 * standing fact; a HOOK planted early; one ARC step.
 *
 * The storyteller marks a natural close with [EPISODE_END] on its own
 * line; chat.js strips the mark from the prose before the page is saved
 * and calls afterEpisodeEnd — the editor reviews the closed episode, then
 * auto mode writes the next directive. Everything here fails quietly: no
 * throw ever reaches the chat path.
 *
 * Store: settings under `director:<storyId>` — backups carry it, letting
 * go of the story lets it go.
 */

import { db } from '../store.js';
import { loadState, renderStateFacts } from '../engine/state.js';
import { pageText } from '../assemble/stack.js';
import { parseFirstObject } from './jsonutil.js';
import { callModel } from './housekeeper.js';
import { maybeRunEditor } from './editor.js';
import { withFictionFrame } from './voice.js'; /* M21: the workers never break the fiction */

const KEY_PREFIX = 'director:';
export const EPISODE_MARK = '[EPISODE_END]';
const RECENT_PAGES = 12;
const PAGE_CAP = 3000;

/* ---------- the mark ---------- */

/* Strip the episode-end mark from finished prose. Returns {text, ended} —
 * the mark never reaches the saved page, and ended tells chat.js to run
 * the closing rituals. */
/* M117: CONTROL TOKENS ON THE WIRE. Some providers let the model's own
 * control tokens (<|open|>, <|sep|>, <|close|>, <|im_end|>, <|eot_id|>) and a
 * tool-call shape (antmlThinking) leak into the content as text. The story is
 * whatever came before the first one; the rest is never a page. Returns the
 * cleaned text and whether anything leaked. */
export const CONTROL_TOKEN = /<\|[a-zA-Z_][a-zA-Z0-9_]{0,31}\|>/;
export function stripControlLeak(text) {
  const str = String(text || '');
  const m = str.match(CONTROL_TOKEN);
  if (!m) return { text: str, leaked: false };
  return { text: str.slice(0, m.index).replace(/\s+$/, ''), leaked: true };
}

export function stripEpisodeEnd(text) {
  const s = String(text == null ? '' : text);
  if (!/\[EPISODE_END\]/i.test(s)) return { text: s, ended: false };
  const cleaned = s
    .replace(/\[EPISODE_END\]/gi, '')
    .replace(/[ \t]+(\n|$)/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();
  return { text: cleaned, ended: true };
}

/* ---------- the state ---------- */

export async function loadDirector(storyId) {
  const fresh = { text: '', episode: 0, concluded: false, auto: false, updatedAt: 0 };
  if (!storyId) return fresh;
  try {
    const saved = await db.settings.get(KEY_PREFIX + storyId);
    if (!saved || typeof saved !== 'object') return fresh;
    return {
      text: typeof saved.text === 'string' ? saved.text : '',
      episode: Number.isFinite(saved.episode) ? Math.max(0, Math.round(saved.episode)) : 0,
      concluded: saved.concluded === true,
      auto: saved.auto === true,
      updatedAt: Number.isFinite(saved.updatedAt) ? saved.updatedAt : 0,
    };
  } catch (err) {
    return fresh;
  }
}

export async function saveDirector(storyId, patch) {
  if (!storyId) return null;
  const current = await loadDirector(storyId);
  const next = { ...current, ...(patch || {}), updatedAt: Date.now() };
  await db.settings.set(KEY_PREFIX + storyId, next);
  return next;
}

export async function markConcluded(storyId) {
  const d = await loadDirector(storyId);
  if (!d.text || d.concluded) return d;
  return saveDirector(storyId, { concluded: true });
}

/* The note that rides the dynamic tail (its own receipt slot, "The
 * director's note"). '' when no directive stands — the slot is omitted. */
export function renderDirectorNote(d) {
  if (!d || typeof d.text !== 'string' || !d.text.trim() || d.concluded) return '';
  return 'Episode ' + (d.episode || 1) + ' — the director’s marching orders:\n'
    + d.text.trim()
    + '\n\nWhen this episode reaches a natural close, end the page with '
    + EPISODE_MARK + ' on its own line, after the prose — never inside it.';
}

/* ---------- the format law ---------- */

export const DIRECTIVE_FORMAT = [
  'PREMISE — one line: what this episode is about.',
  'QUESTION — the dramatic question the episode exists to answer.',
  'BEATS — 3 to 5, each anchored in what somebody wants. Among them: one',
  '  beat that brings in someone from outside the cast; one that turns the',
  '  middle; a final dilemma the episode lands on; and one light B-beat that',
  '  gives the tale air.',
  'NPC & WORLD INITIATIVE — what the world and its people do on their own',
  '  while the writers are busy.',
  'LANDING — how the episode can come down; every branch of the landing',
  '  reprices a standing fact (a debt, a promise, a standing between people).',
  'HOOK — the thread to plant early so the close still pulls forward.',
  'ARC — one honest step of the longer arc.',
].join('\n');

/* ---------- the three passes ---------- */

const DIRECTOR_SYSTEM = [
  'You are the director of a slow, warm story told between two writers in a',
  'cozy tavern. You do not write prose; you keep the episode moving. Your',
  'marching orders name where the pressure is and let the writers play.',
  '',
  'The format is law:',
  DIRECTIVE_FORMAT,
  '',
  'Keep it to about 200 words. Anchor every beat in what someone on the page',
  'already wants — never invent a wanting out of thin air. Plain words, no',
  'markdown, the headings exactly as named above.',
].join('\n');

const POLISH_SYSTEM = [
  'You are the showrunner. A director has sketched an episode directive for a',
  'slow, warm story. Tighten it: every beat must hang on a want already alive',
  'on the page, the LANDING must reprice something standing, the HOOK must be',
  'plantable early. Keep the format headings exactly as they are; cut what',
  'drifts. Answer with the revised directive only.',
].join('\n');

const WATCHER_SYSTEM = [
  'You are the watcher. Check a director’s episode directive against this law:',
  DIRECTIVE_FORMAT,
  'If it holds — every heading present, beats motive-anchored, a dilemma at',
  'the end, a B-beat for air — answer {"ok":true}. If it fails, answer',
  '{"ok":false,"text":"the whole directive, rewritten to hold"}. JSON only.',
].join('\n');

function recentPagesText(messages) {
  const visible = (Array.isArray(messages) ? messages : []).filter((m) => m && !m.hidden);
  return visible.slice(-RECENT_PAGES).map((m) => {
    const speaker = m.role === 'assistant' ? 'the storyteller' : 'the writer';
    let text = pageText(m);
    if (text.length > PAGE_CAP) text = text.slice(0, PAGE_CAP - 1).trimEnd() + '…';
    return speaker.toUpperCase() + ':\n' + text;
  }).join('\n\n');
}

/* The shared picture the passes read. Exported for the harness. */
export function buildDirectorBrief({ story, messages, state, prev, mode, seedText } = {}) {
  const parts = [];
  parts.push('The story is “' + ((story && story.title) || 'an untitled tale') + '”.');
  const brief = story && typeof story.brief === 'string' ? story.brief.trim() : '';
  if (brief) parts.push('Its brief:\n' + brief);
  const ledger = renderStateFacts(state);
  if (ledger) parts.push('What the ledger says:\n' + ledger);
  const pages = recentPagesText(messages);
  if (pages) parts.push('The latest pages:\n' + pages);
  if (prev && prev.text) {
    parts.push('The directive now standing (episode ' + (prev.episode || 1)
      + (prev.concluded ? ', concluded' : '') + '):\n' + prev.text);
  }
  if (mode === 'seed' && seedText) {
    parts.push('The writer planted this seed — grow the episode from it:\n“' + String(seedText).trim() + '”');
  }
  const ask = mode === 'next'
    ? 'The current episode has run its course. Write the marching orders for the NEXT episode.'
    : mode === 'seed'
      ? 'Write the marching orders for an episode grown from the writer’s seed.'
      : 'Write the marching orders for the FIRST episode.';
  parts.push(ask);
  return parts.join('\n\n');
}

/* Write one directive through the three passes. `call` is injectable for
 * the harness; each pass skippable. Never throws — returns
 * {ok, text, passes:{draft, polished, watched}} or {ok:false, error}. */
export async function writeDirective({
  connection, story, messages, state, prev, mode, seedText,
  call, signal, skipPolish, skipWatch,
} = {}) {
  try {
    const caller = typeof call === 'function' ? call : (req) => callModel(connection, req);
    const brief = buildDirectorBrief({ story, messages, state, prev, mode, seedText });

    /* 1 — the draft. */
    const draftAns = await caller({
      system: withFictionFrame(DIRECTOR_SYSTEM),
      messages: [{ role: 'user', content: brief }],
      maxTokens: 900,
      signal,
    });
    if (draftAns && draftAns.error) return { ok: false, error: draftAns.error };
    let text = draftAns && typeof draftAns.text === 'string' ? draftAns.text.trim() : '';
    if (!text) return { ok: false, error: 'the director sketched nothing' };
    const passes = { draft: true, polished: false, watched: false };

    /* 2 — the showrunner's polish (skippable). */
    if (!skipPolish) {
      const polishAns = await caller({
        system: withFictionFrame(POLISH_SYSTEM),
        messages: [{ role: 'user', content: 'The draft:\n\n' + text }],
        maxTokens: 900,
        signal,
      });
      if (polishAns && !polishAns.error && typeof polishAns.text === 'string' && polishAns.text.trim()) {
        text = polishAns.text.trim();
        passes.polished = true;
      }
    }

    /* 3 — the watcher's verdict (skippable). A failed or unreadable
     * verdict never sinks a good directive — the polished text stands. */
    if (!skipWatch) {
      const watchAns = await caller({
        system: withFictionFrame(WATCHER_SYSTEM),
        messages: [{ role: 'user', content: 'The directive:\n\n' + text }],
        maxTokens: 1200,
        signal,
      });
      if (watchAns && !watchAns.error && typeof watchAns.text === 'string') {
        const verdict = parseFirstObject(watchAns.text);
        passes.watched = Boolean(verdict);
        if (verdict && verdict.ok === false && typeof verdict.text === 'string' && verdict.text.trim()) {
          text = verdict.text.trim();
        }
      }
    }

    return { ok: true, text, passes };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'the director stumbled' };
  }
}

/* ---------- the modes ---------- */

/* Run one director mode against a story. Modes:
 *   new     — the first episode (or a fresh start after restart)
 *   next    — close the current, open the next
 *   seed    — grow a directive from the writer's own line (seedText)
 *   edit    — hand-edit the standing text (editText; no model)
 *   restart — clear the board (no model)
 * Never throws. Returns {ok, state, words, error?}. */
export async function runDirector({
  connection, storyId, story, mode, seedText, editText,
  call, signal, skipPolish, skipWatch,
} = {}) {
  try {
    if (!storyId) return { ok: false, error: 'no story is open' };
    const prev = await loadDirector(storyId);

    if (mode === 'restart') {
      const state = await saveDirector(storyId, { text: '', episode: 0, concluded: false });
      return { ok: true, state, words: 'The board is clear — no episode stands.' };
    }
    if (mode === 'edit') {
      const text = typeof editText === 'string' ? editText.trim() : '';
      const state = await saveDirector(storyId, {
        text,
        concluded: false,
        episode: text ? (prev.episode || 1) : 0,
      });
      return { ok: true, state, words: text ? 'The marching orders read differently now.' : 'The marching orders are let go.' };
    }
    if (mode !== 'new' && mode !== 'next' && mode !== 'seed') {
      return { ok: false, error: '“' + String(mode || '?') + '” isn’t a mode the director knows' };
    }

    const tale = story || await db.stories.get(storyId);
    const [messages, state] = await Promise.all([
      db.messages.list(storyId),
      loadState(storyId),
    ]);
    const written = await writeDirective({
      connection, story: tale, messages, state, prev, mode, seedText,
      call, signal, skipPolish, skipWatch,
    });
    if (!written.ok) return { ok: false, error: written.error || 'the director sketched nothing' };

    const episode = mode === 'new'
      ? 1
      : (prev.episode || 0) + (prev.text ? 1 : 0) || 1;
    const next = await saveDirector(storyId, {
      text: written.text,
      episode,
      concluded: false,
    });
    return {
      ok: true,
      state: next,
      words: 'Episode ' + next.episode + ' has its marching orders.',
      passes: written.passes,
    };
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'the director stumbled' };
  }
}

/* M62 (Chat Assistant's director tools, ported): a spoiler-free progress
 * check, three seed ideas to pick from, and the writer's steer (#d). */
export async function directorStatus({ connection, storyId, call, signal } = {}) {
  const d = await loadDirector(storyId);
  if (!d.text) return { ok: false, error: 'no episode stands' };
  if (d.concluded) return { ok: true, words: 'Episode ' + d.episode + ' has concluded — seed or write the next.' };
  const [messages, state] = await Promise.all([db.messages.list(storyId), loadState(storyId)]);
  const pages = messages.filter((m) => !m.hidden).slice(-10).map((m) => (m.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(m.text || '').slice(0, 3000)).join('\n\n');
  const caller = typeof call === 'function' ? call : (req) => callModel(connection, req);
  const answer = await caller({
    system: withFictionFrame('You check a secret episode’s progress for a story’s director. You receive the SECRET DIRECTIVE and the latest pages. Judge how far along the episode is WITHOUT revealing the directive: which beats have landed, which are open, whether the episode question has been answered on screen. Answer in three short lines a player may read without spoilers: where it stands, what is still open (in vague terms), and whether it should conclude.'),
    messages: [{ role: 'user', content: '[LATEST PAGES]\n' + pages + '\n\n[THE SECRET DIRECTIVE]\n' + d.text + '\n\nJudge the progress now, spoiler-free.' }],
    maxTokens: 400, signal,
  });
  if (answer && answer.error) return { ok: false, error: answer.error };
  return { ok: true, words: String(answer.text || '').trim() || 'no word came back' };
}
export async function directorIdeas({ connection, storyId, story, call, signal } = {}) {
  const [messages, state] = await Promise.all([db.messages.list(storyId), loadState(storyId)]);
  const tale = story || await db.stories.get(storyId);
  const pages = messages.filter((m) => !m.hidden).slice(-8).map((m) => (m.role === 'assistant' ? 'STORY: ' : 'PLAYER: ') + String(m.text || '').slice(0, 3000)).join('\n\n');
  const caller = typeof call === 'function' ? call : (req) => callModel(connection, req);
  const answer = await caller({
    system: withFictionFrame('You propose episode SEEDS for a story’s director: three genuinely different doors the next episode could open, one line each — the situation the world brings to the main character and the question it poses, never the player’s answer. Different in kind: one pressure from the past, one from a present want of an NPC, one from the world at large. Answer with the three lines only, numbered.'),
    messages: [{ role: 'user', content: '[THE BRIEF]\n' + String((tale && tale.brief) || '').slice(0, 6000) + '\n\n[THE LEDGER]\n' + (renderStateFacts(state) || '(blank)') + '\n\n[LATEST PAGES]\n' + pages + '\n\nThree doors.' }],
    maxTokens: 500, signal,
  });
  if (answer && answer.error) return { ok: false, error: answer.error };
  return { ok: true, words: String(answer.text || '').trim() || 'no ideas came back' };
}
export async function directorSteer({ connection, storyId, story, direction, call, signal } = {}) {
  const d = await loadDirector(storyId);
  if (!d.text || d.concluded) return { ok: false, error: 'no episode stands to steer — write or seed one first' };
  const caller = typeof call === 'function' ? call : (req) => callModel(connection, req);
  const answer = await caller({
    system: withFictionFrame('You re-aim a story director’s secret episode directive by the writer’s direction, keeping what works. Answer with the whole re-aimed directive only, in the same format as the one you were given.'),
    messages: [{ role: 'user', content: '[THE DIRECTIVE AS IT STANDS]\n' + d.text + '\n\n[THE WRITER’S DIRECTION]\n' + String(direction || '').slice(0, 2000) + '\n\nRe-aim it.' }],
    maxTokens: 2500, signal,
  });
  if (answer && answer.error) return { ok: false, error: answer.error };
  const text = String(answer.text || '').trim();
  if (!text) return { ok: false, error: 'nothing came back' };
  const next = await saveDirector(storyId, { text, concluded: false });
  return { ok: true, state: next, words: 'Episode ' + next.episode + ' is re-aimed.' };
}
export async function directorOff(storyId) {
  const state = await saveDirector(storyId, { text: '', episode: 0, concluded: false });
  return { ok: true, state, words: 'The director stands down — no episode, numbering reset.' };
}

/* Auto mode: only ever in the background, only ever one directive active.
 * Fires when auto is on and no directive stands active (none written, or
 * the last concluded). */
export async function maybeAutoDirector({ connection, storyId, story, call, signal } = {}) {
  try {
    const d = await loadDirector(storyId);
    if (!d.auto) return null;
    if (d.text && !d.concluded) return null; // one active at a time
    return runDirector({
      connection, storyId, story,
      mode: d.episode > 0 ? 'next' : 'new',
      call, signal,
    });
  } catch (err) {
    return null;
  }
}

/* The closing rituals (M10): the storyteller marked [EPISODE_END], the
 * page is already saved clean. The episode is marked concluded; the editor
 * reviews the closed episode when it's on; then auto mode writes the next
 * directive. Background only; never throws. */
export async function afterEpisodeEnd({ connection, storyId, story, call, signal } = {}) {
  try {
    await markConcluded(storyId);
    const editor = await maybeRunEditor({
      connection, story, storyId, reason: 'episode end', call, signal,
    });
    const d = await loadDirector(storyId);
    let director = null;
    if (d.auto) {
      director = await runDirector({
        connection, storyId, story, mode: 'next', call, signal,
      });
    }
    return { editor: editor || null, director: director || null };
  } catch (err) {
    return { editor: null, director: null };
  }
}
