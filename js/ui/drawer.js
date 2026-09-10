/* Cozy Tavern — ui/drawer.js
 * The right-hand slide-over: "The story's ledger". M3 woke it up: the clock
 * keeps the hour, Who's here carries position and attire when known, the
 * mood of the scene reads its flags in plain words, and "What changed and
 * why" reads the log the applier writes — newest first, each change
 * take-back-able. M4 filled the last panels: "How they're holding up" (the
 * body ledger), "On their mind" (the standings between people, real now),
 * and "What's happening elsewhere" (the off-screen world). M6 brought the
 * agents' shelves: "The house has ruled" (the referee's latest ruling),
 * "What's true of them" (the canon store, hand-editable), and "Something
 * drifted" (the continuity reader's notes). M7 taught Who's here one more
 * trick: cards from the cast library can be invited into the story (and the
 * invitation let go) right beside the hand-written names. Hand controls go
 * through the same mutations the extractor proposes, so everything is
 * validated, logged, and undoable alike.
 *
 * Live refresh: the drawer subscribes to the active story's state
 * (state.subscribe/notify); when the engine writes, the panels re-render if
 * the drawer is open.
 */

import { loadState, saveState, subscribe, notify } from '../engine/state.js';
import { applyMutations, undoLast, MODE_WORDS } from '../engine/apply.js';
import { renderClock, REAL_MONTHS, REAL_DAYS } from '../engine/clock.js';
import { SEV_WORDS } from '../engine/bodies.js';
import { axisWords, historyWords, AXES } from '../engine/relationships.js';
import { isMc } from '../engine/people.js';
import { listCast, attachToStory, detachFromStory } from '../import/cards.js';
import { loadWorkerStatus, WORKER_NAMES, runningWorkers, onWorkerChange } from '../agents/status.js';
import { renderArrival } from '../engine/world.js'; /* M29: the world beyond the page */
import { db } from '../store.js';

/* ---------- shared helpers ---------- */

/* M15 audit: the workers line below called a whenWords() that never
 * existed — the panel died exactly when it finally had something to say.
 * The ledger speaks in relative time, the way a reader remembers. */
function fmtWhenWords(ts) {
  if (!ts) return '';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return mins === 1 ? 'a minute ago' : mins + ' minutes ago';
  const hours = Math.round(mins / 60);
  if (hours < 24) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
  const days = Math.round(hours / 24);
  if (days === 1) return 'yesterday';
  return days + ' days ago';
}

async function currentStory(ctx) {
  const id = ctx.getActiveStoryId();
  return id ? db.stories.get(id) : undefined;
}

/* Hand changes ride the same rails as the extractor's: proposed as
 * mutations, applied, saved, announced. Returns the applied words (unused
 * by most callers; the log panel shows them soon enough). */
async function handMutate(ctx, mutations) {
  const story = await currentStory(ctx);
  if (!story) return [];
  const state = await loadState(story.id);
  const { state: next, applied } = applyMutations(state, mutations);
  if (applied.length) {
    await saveState(story.id, next);
    notify(story.id);
  }
  return applied;
}

function quietNote(text) {
  const p = document.createElement('p');
  p.className = 'quiet';
  p.textContent = text;
  return p;
}

/* B6 (M9): one in-flight render per panel, latest wins. A panel's render
 * is async; a second call while the first is still reading the store used
 * to interleave DOM writes (doubled rows, lost order). latestWins wraps a
 * render so a call during a run is remembered and re-run once, fresh, when
 * the run settles. */
export function latestWins(fn) {
  let running = false;
  let queued = false;
  return async function guarded(...args) {
    if (running) { queued = true; return; }
    running = true;
    try {
      do {
        queued = false;
        await fn.apply(this, args);
      } while (queued);
    } finally {
      running = false;
      queued = false;
    }
  };
}

/* ---------- the clock ---------- */

function clockPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'clock-editor';

  /* M26: the ground the scene stands on + the masthead switch. */
  const placeForm = document.createElement('form');
  placeForm.className = 'present-form';
  const placeInput = document.createElement('input');
  placeInput.type = 'text';
  placeInput.placeholder = 'Where the scene stands…';
  placeInput.setAttribute('aria-label', 'Where the scene stands');
  const placeBtn = document.createElement('button');
  placeBtn.type = 'submit';
  placeBtn.className = 'text-btn';
  placeBtn.textContent = 'Set the place';
  placeForm.append(placeInput, placeBtn);
  placeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = placeInput.value.trim();
    if (!name) return;
    await handMutate(ctx, [{ type: 'place.set', name }]);
    placeInput.value = '';
  });
  const placeRow = document.createElement('div');
  placeRow.appendChild(placeForm);
  wrap.appendChild(placeRow);

  const mastRow = document.createElement('label');
  mastRow.className = 'radio-row';
  const mastCheck = document.createElement('input');
  mastCheck.type = 'checkbox';
  mastCheck.checked = true;
  const mastText = document.createElement('span');
  mastText.textContent = 'The masthead — the house writes the header line itself';
  mastRow.append(mastCheck, mastText);
  db.settings.get('masthead').then((v) => { mastCheck.checked = v !== false; });
  mastCheck.addEventListener('change', async () => {
    await db.settings.set('masthead', mastCheck.checked);
    if (ctx.onStoriesChanged) ctx.onStoriesChanged();
  });
  wrap.appendChild(mastRow);

  const label = document.createElement('p');
  label.className = 'clock-label';

  const advanceRow = document.createElement('div');
  advanceRow.className = 'row';

  const customForm = document.createElement('form');
  customForm.className = 'present-form';
  const customInput = document.createElement('input');
  customInput.type = 'number';
  customInput.min = '1';
  customInput.placeholder = 'Minutes';
  customInput.setAttribute('aria-label', 'Move the clock on by this many minutes');
  const customBtn = document.createElement('button');
  customBtn.type = 'submit';
  customBtn.className = 'text-btn';
  customBtn.textContent = 'Move it on';
  customForm.append(customInput, customBtn);

  /* Set-by-hand: five small fields and a kind word. */
  const setForm = document.createElement('form');
  setForm.className = 'clock-set-form';
  const fields = {};
  const fieldDefs = [
    ['year', 'Year', 2026, -9999, 99999],
    ['month', 'Month', 1, 1, 12],
    ['day', 'Day', 1, 1, 31],
    ['hour', 'Hour', 9, 0, 23],
    ['minute', 'Minute', 0, 0, 59],
  ];
  for (const [key, name, ph, min, max] of fieldDefs) {
    const lab = document.createElement('label');
    lab.className = 'clock-field';
    lab.textContent = name;
    const input = document.createElement('input');
    input.type = 'number';
    input.min = String(min);
    input.max = String(max);
    input.placeholder = String(ph);
    input.setAttribute('aria-label', 'The clock’s ' + name.toLowerCase());
    fields[key] = input;
    lab.appendChild(input);
    setForm.appendChild(lab);
  }
  const setBtn = document.createElement('button');
  setBtn.type = 'submit';
  setBtn.className = 'text-btn';
  setBtn.textContent = 'Set the clock';
  setForm.appendChild(setBtn);

  /* The calendar: the real world's, or one of the story's own. */
  const calWrap = document.createElement('div');
  calWrap.className = 'calendar-editor';
  const calRow = document.createElement('label');
  calRow.className = 'radio-row';
  const calSelect = document.createElement('select');
  calSelect.setAttribute('aria-label', 'Which calendar the story keeps');
  const optReal = document.createElement('option');
  optReal.value = 'real';
  optReal.textContent = 'The calendar we live by';
  const optCustom = document.createElement('option');
  optCustom.value = 'custom';
  optCustom.textContent = 'A calendar of its own';
  calSelect.append(optReal, optCustom);
  calRow.appendChild(calSelect);

  const monthsInput = document.createElement('input');
  monthsInput.type = 'text';
  monthsInput.placeholder = REAL_MONTHS.join(', ');
  monthsInput.setAttribute('aria-label', 'The year’s months, in order, comma by comma');
  const daysInput = document.createElement('input');
  daysInput.type = 'text';
  daysInput.placeholder = REAL_DAYS.join(', ');
  daysInput.setAttribute('aria-label', 'The week’s days, in order, comma by comma');
  const calSave = document.createElement('button');
  calSave.type = 'button';
  calSave.className = 'text-btn';
  calSave.textContent = 'Keep the names';
  calWrap.append(calRow, monthsInput, daysInput, calSave);

  wrap.append(label, advanceRow, customForm, setForm, calWrap);

  function readFields() {
    const out = {};
    for (const key of Object.keys(fields)) out[key] = Number(fields[key].value);
    return out;
  }

  setForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = readFields();
    if (![v.year, v.month, v.day, v.hour, v.minute].every((n) => Number.isFinite(n))) return;
    await handMutate(ctx, [{ type: 'clock.set', ...v }]);
    render();
  });

  async function advance(minutes, reason) {
    await handMutate(ctx, [{ type: 'clock.advance', minutes, reason }]);
    render();
  }

  customForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const minutes = Number(customInput.value);
    if (!Number.isFinite(minutes) || minutes <= 0) return;
    customInput.value = '';
    await advance(minutes, 'moved on by hand');
  });

  calSelect.addEventListener('change', async () => {
    const story = await currentStory(ctx);
    if (!story) return;
    const state = await loadState(story.id);
    if (!state.clock) return;
    state.clock.calendar = calSelect.value === 'custom' ? 'custom' : 'real';
    state.clock.label = renderClock(state.clock);
    await saveState(story.id, state);
    notify(story.id);
    render();
  });

  calSave.addEventListener('click', async () => {
    const story = await currentStory(ctx);
    if (!story) return;
    const state = await loadState(story.id);
    if (!state.clock) return;
    const months = monthsInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    const days = daysInput.value.split(',').map((s) => s.trim()).filter(Boolean);
    if (months.length) state.clock.monthNames = months.slice(0, 12);
    if (days.length) state.clock.dayNames = days.slice(0, 7);
    state.clock.calendar = 'custom';
    state.clock.label = renderClock(state.clock);
    await saveState(story.id, state);
    notify(story.id);
    render();
  });

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    const state = story ? await loadState(story.id) : null;
    const clock = state && state.clock;

    advanceRow.textContent = '';
    if (!story) {
      label.textContent = 'Open a story and the clock will know whose hours these are.';
      advanceRow.hidden = customForm.hidden = setForm.hidden = calWrap.hidden = true;
      return;
    }
    setForm.hidden = false;
    if (!clock) {
      label.textContent = 'No time set yet. Set it by hand below, or let the story find its hour.';
      advanceRow.hidden = customForm.hidden = calWrap.hidden = true;
      return;
    }

    label.textContent = renderClock(clock) || clock.label || 'No time set yet.';
    advanceRow.hidden = customForm.hidden = calWrap.hidden = false;

    for (const [text, minutes] of [['+15m', 15], ['+1h', 60]]) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'text-btn';
      btn.textContent = text;
      btn.addEventListener('click', () => advance(minutes, 'moved on by hand'));
      advanceRow.appendChild(btn);
    }

    calSelect.value = clock.calendar === 'custom' ? 'custom' : 'real';
    const custom = clock.calendar === 'custom';
    monthsInput.hidden = daysInput.hidden = calSave.hidden = !custom;
    monthsInput.value = Array.isArray(clock.monthNames) ? clock.monthNames.filter(Boolean).join(', ') : '';
    daysInput.value = Array.isArray(clock.dayNames) ? clock.dayNames.filter(Boolean).join(', ') : '';
  });

  render();
  return wrap;
}

/* ---------- who's here ---------- */

/* A name may carry a she/her mark — "Mira (she/her)" — which one of the
 * house rules listens for (see the acoustics predicate in modules.js).
 * M3: entries may also carry where they are and what they're wearing, and
 * add/remove go through the mutation applier so they're logged. */
function whosHerePanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'present-editor';

  const list = document.createElement('ul');
  list.className = 'present-list';
  const note = document.createElement('p');
  note.className = 'quiet';
  const form = document.createElement('form');
  form.className = 'present-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.maxLength = 60;
  input.placeholder = 'Who just walked in?';
  input.setAttribute('aria-label', 'A name to write into the scene');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Add';
  form.append(input, addBtn);

  /* M7: the invited cast — cards from the library this story has booked.
   * Each carries a book-mark; an invite row offers whoever is still on the
   * shelf. */
  const castHead = document.createElement('p');
  castHead.className = 'quiet cast-head';
  const castList = document.createElement('ul');
  castList.className = 'present-list';
  const inviteForm = document.createElement('form');
  inviteForm.className = 'present-form';
  const inviteSelect = document.createElement('select');
  inviteSelect.setAttribute('aria-label', 'Someone from the cast library to invite in');
  const inviteBtn = document.createElement('button');
  inviteBtn.type = 'submit';
  inviteBtn.className = 'text-btn';
  inviteBtn.textContent = 'Invite them in';
  inviteForm.append(inviteSelect, inviteBtn);
  wrap.append(list, note, form, castHead, castList, inviteForm);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    castList.textContent = '';
    inviteSelect.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose scene this is.';
      form.hidden = true;
      castHead.hidden = castList.hidden = inviteForm.hidden = true;
      return;
    }
    form.hidden = false;
    const state = await loadState(story.id);
    const present = Array.isArray(state.present) ? state.present : [];
    note.textContent = present.length
      ? 'In the scene right now:'
      : 'No one is written in yet. Add a name and the storyteller will know they’re here.';
    for (const entry of present) {
      const li = document.createElement('li');
      li.className = 'present-row';
      const name = document.createElement('span');
      const detail = [entry.position, entry.attire]
        .filter((s) => typeof s === 'string' && s.trim())
        .join(', ');
      name.textContent = detail ? entry.name + ' — ' + detail : entry.name;
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'story-mini';
      out.title = 'They step out';
      out.setAttribute('aria-label', `${entry.name} steps out of the scene`);
      out.textContent = '×';
      out.addEventListener('click', async () => {
        await handMutate(ctx, [{ type: 'presence.leave', name: entry.name }]);
        render();
      });
      li.append(name, out);
      list.appendChild(li);
    }

    /* The invited cast (M7): cards booked into this story. The book-mark
     * (❧) is simply how a card rows reads; the × lets the invitation go.
     * When a card's name is also written into the scene above, the next
     * turn's "Who's here" carries the card's words too (slot 4). */
    const library = await listCast();
    const invitedIds = Array.isArray(story.castIds) ? story.castIds : [];
    const invited = library.filter((c) => invitedIds.includes(c.id));
    const onTheShelf = library.filter((c) => !invitedIds.includes(c.id));

    castHead.hidden = castList.hidden = inviteForm.hidden = false;
    castHead.textContent = invited.length
      ? 'Booked into this story’s cast:'
      : (library.length
        ? 'No cards are booked into this story yet.'
        : 'The cast library is empty — cards come home in Settings, under Bring your people.');

    for (const card of invited) {
      const li = document.createElement('li');
      li.className = 'present-row';
      const words = document.createElement('span');
      words.textContent = '❧ ' + card.name;
      words.title = 'A card from the cast library';
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'story-mini';
      out.title = 'Let the invitation go';
      out.setAttribute('aria-label', `${card.name}’s card leaves this story’s cast`);
      out.textContent = '×';
      out.addEventListener('click', async () => {
        await detachFromStory(story.id, card.id);
        render();
      });
      li.append(words, out);
      castList.appendChild(li);
    }

    if (onTheShelf.length) {
      for (const card of onTheShelf) {
        const opt = document.createElement('option');
        opt.value = card.id;
        opt.textContent = card.name;
        inviteSelect.appendChild(opt);
      }
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = library.length ? 'Everyone’s already invited' : 'No cards on the shelf yet';
      inviteSelect.appendChild(opt);
    }
    inviteBtn.disabled = !onTheShelf.length;
  });

  inviteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const story = await currentStory(ctx);
    const cardId = inviteSelect.value;
    if (!story || !cardId) return;
    await attachToStory(story.id, cardId);

    /* M9: a card arrives properly. If its name isn't already in the scene,
     * it takes a seat (presence.enter) — the next turn's "Who's here"
     * carries the card's words (slot 4 only speaks for the present). And
     * when the page is still blank and the card brought a greeting, the
     * greeting is OFFERED as the story's opener — never forced. */
    const library = await listCast();
    const card = library.find((c) => c.id === cardId);
    if (card && typeof card.name === 'string' && card.name.trim()) {
      const state = await loadState(story.id);
      const present = Array.isArray(state.present) ? state.present : [];
      const bare = (s) => String(s || '').replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      if (!present.some((p) => p && bare(p.name) === bare(card.name))) {
        await handMutate(ctx, [{ type: 'presence.enter', name: card.name }]);
      }
      const history = await db.messages.list(story.id);
      const greeting = typeof card.firstMes === 'string' ? card.firstMes.trim() : '';
      if (greeting && !history.some((m) => m && !m.hidden)) {
        const yes = window.confirm(
          `Begin with ${card.name}’s own greeting? Their card brought opening words.`
        );
        if (yes) {
          await db.messages.append(story.id, { role: 'assistant', text: greeting });
          if (ctx.chat && ctx.chat.renderThread) await ctx.chat.renderThread({ structural: true });
        }
      }
    }
    render();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    if (!name) return;
    input.value = '';
    await handMutate(ctx, [{ type: 'presence.enter', name }]);
    render();
  });

  render();
  return wrap;
}

/* ---------- the mood of the scene ---------- */

const MOOD_ORDER = ['combat', 'intimate', 'travel', 'socialField', 'isolation', 'group'];

function moodPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'mood-editor';
  const note = quietNote('');
  const rows = document.createElement('div');
  rows.className = 'mood-rows';
  wrap.append(note, rows);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    rows.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the scene will say how it feels.';
      return;
    }
    const state = await loadState(story.id);
    const mode = state.mode || {};
    const active = MOOD_ORDER.filter((flag) => mode[flag]);
    note.textContent = active.length
      ? 'Right now: ' + active.map((flag) => MODE_WORDS[flag].on.toLowerCase()).join('; ') + '.'
      : 'No particular mood on the scene. The workers set these as the story turns; you can too.';
    for (const flag of MOOD_ORDER) {
      const row = document.createElement('label');
      row.className = 'radio-row mood-row';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = Boolean(mode[flag]);
      const words = document.createElement('span');
      words.textContent = MODE_WORDS[flag].on;
      box.addEventListener('change', async () => {
        await handMutate(ctx, [{ type: box.checked ? 'mode.set' : 'mode.clear', flag }]);
        render();
      });
      row.append(box, words);
      rows.appendChild(row);
    }
  });

  render();
  return wrap;
}

/* ---------- what changed and why ---------- */

function logPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'log-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'log-list';
  wrap.append(note, list);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and its changes will be written down here.';
      return;
    }
    const state = await loadState(story.id);
    const log = Array.isArray(state.log) ? state.log : [];
    if (!log.length) {
      note.textContent = 'Nothing has changed hands yet. When the story moves, it will be written down here, in plain words.';
      return;
    }
    note.textContent = 'Newest first. The last change that still stands can be taken back.';
    const newestFirst = log.slice(-12).reverse();
    /* Only the newest entry that still stands is undoable (undoLast). */
    const newestUndoable = log.length - 1 - [...log].reverse().findIndex((e) => e && !e.undone && e.undo);
    for (const entry of newestFirst) {
      const li = document.createElement('li');
      li.className = 'log-row' + (entry.undone ? ' undone' : '');
      const words = document.createElement('span');
      words.textContent = entry.words + (entry.undone ? ' (taken back)' : '');
      li.appendChild(words);
      if (!entry.undone && entry.undo && log.indexOf(entry) === newestUndoable) {
        const undoBtn = document.createElement('button');
        undoBtn.type = 'button';
        undoBtn.className = 'text-btn';
        undoBtn.textContent = 'Take it back';
        undoBtn.addEventListener('click', async () => {
          const fresh = await loadState(story.id);
          const result = undoLast(fresh);
          if (result) {
            await saveState(story.id, result.state);
            notify(story.id);
          }
          render();
        });
        li.appendChild(undoBtn);
      }
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- how they're holding up (M4 — the body ledger) ---------- */

function holdingUpPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'bodies-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';

  /* Add by hand: a hurt or a weariness, riding the same mutations the
   * workers propose. */
  const form = document.createElement('form');
  form.className = 'present-form ledger-form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.placeholder = 'Who?';
  nameInput.setAttribute('aria-label', 'Who carries it');
  const whatInput = document.createElement('input');
  whatInput.type = 'text';
  whatInput.maxLength = 140;
  whatInput.placeholder = 'What happened?';
  whatInput.setAttribute('aria-label', 'The hurt or weariness, in a few words');
  const kindSelect = document.createElement('select');
  kindSelect.setAttribute('aria-label', 'A hurt, or a weariness');
  const optHurt = document.createElement('option');
  optHurt.value = 'injury';
  optHurt.textContent = 'A hurt';
  const optStrain = document.createElement('option');
  optStrain.value = 'strain';
  optStrain.textContent = 'A weariness';
  kindSelect.append(optHurt, optStrain);
  const sevSelect = document.createElement('select');
  sevSelect.setAttribute('aria-label', 'How bad is it');
  for (const [sev, words] of [[1, 'A graze'], [2, 'A real wound'], [3, 'Severe']]) {
    const opt = document.createElement('option');
    opt.value = String(sev);
    opt.textContent = words;
    sevSelect.appendChild(opt);
  }
  const treatedLabel = document.createElement('label');
  treatedLabel.className = 'radio-row';
  const treatedBox = document.createElement('input');
  treatedBox.type = 'checkbox';
  treatedLabel.append(treatedBox, document.createTextNode(' Seen to'));
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Write it down';
  form.append(nameInput, whatInput, kindSelect, sevSelect, treatedLabel, addBtn);

  wrap.append(note, list, form);

  function syncKind() {
    const hurt = kindSelect.value === 'injury';
    sevSelect.hidden = treatedLabel.hidden = !hurt;
  }
  kindSelect.addEventListener('change', syncKind);
  syncKind();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const what = whatInput.value.trim();
    if (!name || !what) return;
    const mutation = kindSelect.value === 'injury'
      ? { type: 'body.injure', name, what, sev: Number(sevSelect.value), treated: treatedBox.checked }
      : { type: 'body.strain', name, what };
    nameInput.value = whatInput.value = '';
    treatedBox.checked = false;
    await handMutate(ctx, [mutation]);
    render();
  });

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose bodies these are.';
      form.hidden = true;
      return;
    }
    form.hidden = false;
    const state = await loadState(story.id);
    const bodies = state.bodies && typeof state.bodies === 'object' ? state.bodies : {};
    const names = Object.keys(bodies).filter((n) => {
      const b = bodies[n];
      return b && ((Array.isArray(b.injuries) && b.injuries.length)
        || (Array.isArray(b.strain) && b.strain.length));
    });
    note.textContent = names.length
      ? 'What the body keeps, and whether it’s healing. Healed hurts stay on record but stop showing.'
      : 'No one carries a hurt yet. When a blow lands on the page, it will be written down here.';
    for (const name of names) {
      const body = bodies[name];
      const injuries = Array.isArray(body.injuries) ? body.injuries : [];
      const strain = Array.isArray(body.strain) ? body.strain : [];
      for (const injury of injuries) {
        const li = document.createElement('li');
        li.className = 'present-row';
        const words = document.createElement('span');
        words.textContent = name + ' — ' + injury.what
          + ' (' + (SEV_WORDS[injury.sev] || SEV_WORDS[1])
          + (injury.healed ? ', healed' : injury.treated ? ', seen to' : ', untreated') + ')';
        li.appendChild(words);
        if (!injury.healed) {
          const healBtn = document.createElement('button');
          healBtn.type = 'button';
          healBtn.className = 'text-btn';
          healBtn.textContent = 'It’s healed';
          healBtn.addEventListener('click', async () => {
            await handMutate(ctx, [{ type: 'body.heal', name, what: injury.what }]);
            render();
          });
          li.appendChild(healBtn);
        }
        list.appendChild(li);
      }
      for (const worn of strain) {
        const li = document.createElement('li');
        li.className = 'present-row';
        const words = document.createElement('span');
        words.textContent = name + ' — worn: ' + worn.what;
        const liftBtn = document.createElement('button');
        liftBtn.type = 'button';
        liftBtn.className = 'text-btn';
        liftBtn.textContent = 'It’s lifted';
        liftBtn.addEventListener('click', async () => {
          await handMutate(ctx, [{ type: 'body.heal', name, what: worn.what }]);
          render();
        });
        li.append(words, liftBtn);
        list.appendChild(li);
      }
    }
  });

  render();
  return wrap;
}

/* ---------- on their mind (M4 — the standings between people) ---------- */

const AXIS_LABELS = { p: 'Warmth (P)', r: 'Romantic pull (R)', s: 'Sensual charge (S)' };

function onTheirMindPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'relationships-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';

  const form = document.createElement('form');
  form.className = 'present-form ledger-form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.placeholder = 'Who?';
  nameInput.setAttribute('aria-label', 'Whose feelings shifted');
  const axisSelect = document.createElement('select');
  axisSelect.setAttribute('aria-label', 'Which feeling moved');
  for (const axis of AXES) {
    const opt = document.createElement('option');
    opt.value = axis;
    opt.textContent = AXIS_LABELS[axis];
    axisSelect.appendChild(opt);
  }
  const modeSelect = document.createElement('select');
  modeSelect.setAttribute('aria-label', 'Shift it, or set it outright');
  const optShift = document.createElement('option');
  optShift.value = 'shift';
  optShift.textContent = 'Shift by';
  const optSet = document.createElement('option');
  optSet.value = 'set';
  optSet.textContent = 'Set it to';
  modeSelect.append(optShift, optSet);
  const amountInput = document.createElement('input');
  amountInput.type = 'number';
  amountInput.min = '-100';
  amountInput.max = '100';
  amountInput.placeholder = '0';
  amountInput.setAttribute('aria-label', 'How much — minus means cooler');
  const causeInput = document.createElement('input');
  causeInput.type = 'text';
  causeInput.maxLength = 200;
  causeInput.placeholder = 'What earned it? (needed)';
  causeInput.setAttribute('aria-label', 'The cause, in words — required');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Write it down';
  form.append(nameInput, axisSelect, modeSelect, amountInput, causeInput, addBtn);

  wrap.append(note, list, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);
    const cause = causeInput.value.trim();
    if (!name || !Number.isFinite(amount) || !cause) return; // a cause, always
    const axis = axisSelect.value;
    const mutation = modeSelect.value === 'set'
      ? { type: 'rel.set', name, [axis]: amount, cause }
      : { type: 'rel.shift', name, axis, delta: amount, cause };
    nameInput.value = amountInput.value = causeInput.value = '';
    await handMutate(ctx, [mutation]);
    render();
  });

  /* M12: the character ledger lives here too — who each person is, where
   * they are, how things stand, and their loose ends; the scribe writes it
   * after each turn, and the writer's hand writes it through the same
   * validated, undoable mutation (people.set). */
  const ledgerHead = document.createElement('h4');
  ledgerHead.className = 'lbl ledger-subhead';
  ledgerHead.textContent = 'The character pages';
  const ledgerNote = quietNote('');
  const ledgerList = document.createElement('ul');
  ledgerList.className = 'present-list';

  const ledgerForm = document.createElement('form');
  ledgerForm.className = 'present-form ledger-form';
  const personInput = document.createElement('input');
  personInput.type = 'text';
  personInput.maxLength = 60;
  personInput.placeholder = 'Whose page?';
  personInput.setAttribute('aria-label', 'Whose character page');
  const fieldSelect = document.createElement('select');
  fieldSelect.setAttribute('aria-label', 'Which page of their ledger');
  for (const [value, words] of [
    ['state', 'Where they are'],
    ['core', 'Their nature'],
    ['arc', 'How things stand'],
    ['threads', 'Loose ends (separate with ;)'],
  ]) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = words;
    fieldSelect.appendChild(opt);
  }
  const textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.maxLength = 300;
  textInput.placeholder = 'What to write down';
  textInput.setAttribute('aria-label', 'What to write on their page');
  const writeBtn = document.createElement('button');
  writeBtn.type = 'submit';
  writeBtn.className = 'text-btn';
  writeBtn.textContent = 'Write it on their page';
  ledgerForm.append(personInput, fieldSelect, textInput, writeBtn);

  ledgerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = personInput.value.trim();
    const text = textInput.value.trim();
    if (!name || !text) return;
    const mutation = { type: 'people.set', name, field: fieldSelect.value, text };
    personInput.value = textInput.value = '';
    await handMutate(ctx, [mutation]);
    render();
  });

  wrap.append(ledgerHead, ledgerNote, ledgerList, ledgerForm);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    ledgerList.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose hearts these are.';
      ledgerNote.textContent = '';
      form.hidden = true;
      ledgerForm.hidden = true;
      return;
    }
    form.hidden = false;
    ledgerForm.hidden = false;
    const state = await loadState(story.id);
    const rel = state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
    const names = Object.keys(rel).filter((n) => rel[n] && typeof rel[n] === 'object');
    note.textContent = names.length
      ? 'How they stand toward the main character — warmth, pull, charge. Nothing moves without a cause.'
      : 'No standings written yet. Feelings are only written down when something on the page earns it.';

    /* The character pages (M12). The main character's page is record-only —
     * where they are and their loose ends; nature and arc are never
     * written there. */
    const characters = state.characters && typeof state.characters === 'object' ? state.characters : {};
    const people = Object.keys(characters).filter((n) => characters[n] && typeof characters[n] === 'object');
    ledgerNote.textContent = people.length
      ? 'Who they are, where they are, how it stands, what’s still open. The scribe writes after each turn; you can write by hand, and every line can be taken back from “What changed and why”.'
      : 'No character pages yet. As the story turns, the scribe writes them here — or write one by hand below.';
    for (const name of people) {
      const entry = characters[name];
      const isTheMc = isMc(state, name);
      const li = document.createElement('li');
      li.className = 'present-row mind-row';
      const head = document.createElement('span');
      head.textContent = name + (isTheMc ? ' (that’s you)' : '');
      li.appendChild(head);
      const line = (label, text) => {
        if (!text) return;
        const small = document.createElement('small');
        small.className = 'quiet';
        small.textContent = label + text;
        li.appendChild(small);
      };
      line('', entry.core);
      line('Now: ', entry.state);
      line('Between you: ', entry.arc);
      if (Array.isArray(entry.threads) && entry.threads.length) {
        line('Loose ends: ', entry.threads.join('; '));
      }
      ledgerList.appendChild(li);
    }
    for (const name of names) {
      const entry = rel[name];
      const li = document.createElement('li');
      li.className = 'present-row mind-row';
      const parts = AXES.map((axis) => axisWords(axis, entry[axis])).filter(Boolean);
      const words = document.createElement('span');
      words.textContent = name + ' — ' + (parts.join(', ') || 'neutral all through');
      li.appendChild(words);
      const since = historyWords(entry);
      if (since) {
        const hist = document.createElement('small');
        hist.className = 'quiet';
        hist.textContent = since;
        li.appendChild(hist);
      }
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- what's happening elsewhere (M4 — the off-screen world) ------ */

function elsewherePanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'offscreen-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';

  const form = document.createElement('form');
  form.className = 'present-form ledger-form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.placeholder = 'Who?';
  nameInput.setAttribute('aria-label', 'Who is elsewhere');
  const whereInput = document.createElement('input');
  whereInput.type = 'text';
  whereInput.maxLength = 120;
  whereInput.placeholder = 'Where?';
  whereInput.setAttribute('aria-label', 'Where they’ve gone');
  const doingInput = document.createElement('input');
  doingInput.type = 'text';
  doingInput.maxLength = 140;
  doingInput.placeholder = 'What they’re at';
  doingInput.setAttribute('aria-label', 'What they’re doing there');
  const agendaInput = document.createElement('input');
  agendaInput.type = 'text';
  agendaInput.maxLength = 140;
  agendaInput.placeholder = 'Meaning to… (if known)';
  agendaInput.setAttribute('aria-label', 'What they mean to do next, if known');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Seat them there';
  form.append(nameInput, whereInput, doingInput, agendaInput, addBtn);

  wrap.append(note, list, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const location = whereInput.value.trim();
    const activity = doingInput.value.trim();
    if (!name || (!location && !activity)) return;
    const agenda = agendaInput.value.trim();
    const mutation = { type: 'offscreen.set', name, location, activity };
    if (agenda) mutation.agenda = agenda;
    nameInput.value = whereInput.value = doingInput.value = agendaInput.value = '';
    await handMutate(ctx, [mutation]);
    render();
  });

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose world this is.';
      form.hidden = true;
      return;
    }
    form.hidden = false;
    const state = await loadState(story.id);
    const offscreen = state.offscreen && typeof state.offscreen === 'object' ? state.offscreen : {};
    const names = Object.keys(offscreen).filter((n) => offscreen[n] && typeof offscreen[n] === 'object');
    note.textContent = names.length
      ? 'Where the absent have gone. Coming back into the scene lets the note go on its own.'
      : 'No one is written elsewhere yet. When someone leaves the page for a known place, it lands here.';
    for (const name of names) {
      const entry = offscreen[name];
      const li = document.createElement('li');
      li.className = 'present-row mind-row';
      const words = document.createElement('span');
      let text = name + ' — '
        + [entry.location, entry.activity].filter((s) => typeof s === 'string' && s.trim()).join(', ');
      if (typeof entry.agenda === 'string' && entry.agenda.trim()) {
        text += ' (meaning to ' + entry.agenda.trim().replace(/\.+$/, '') + ')';
      }
      /* M29: the stance and the arrival on the clock */
      const approach = renderArrival(entry, state.clock && Number.isFinite(state.clock.minutes) ? state.clock.minutes : null);
      if (approach) text += ' — ' + approach;
      words.textContent = text;
      const clearBtn = document.createElement('button');
      clearBtn.type = 'button';
      clearBtn.className = 'text-btn';
      clearBtn.textContent = 'Let it go';
      clearBtn.addEventListener('click', async () => {
        await handMutate(ctx, [{ type: 'offscreen.clear', name }]);
        render();
      });
      li.append(words, clearBtn);
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- the house has ruled (M6 — the referee's latest ruling) ------ */

function verdictPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'verdict-editor';
  const note = quietNote('');
  const line = document.createElement('p');
  line.className = 'verdict-line';
  wrap.append(note, line);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    line.textContent = '';
    line.hidden = true;
    if (!story) {
      note.textContent = 'Open a story and the house will know whose chances these are.';
      return;
    }
    const state = await loadState(story.id);
    /* The standing ruling (pendingVerdict) is consumed by the very next
     * turn; what the drawer keeps is the echo (lastVerdict). */
    const verdict = (state.pendingVerdict && typeof state.pendingVerdict === 'object'
      ? state.pendingVerdict : null)
      || (state.lastVerdict && typeof state.lastVerdict === 'object' ? state.lastVerdict : null);
    if (!verdict || typeof verdict.words !== 'string' || !verdict.words.trim()) {
      note.textContent = 'No rulings yet. When a chancy moment is called — a #roll, or a fight on — the house rules here first, before the storyteller writes.';
      return;
    }
    note.textContent = state.pendingVerdict
      ? 'Ruled just now — it rides into the very next page as fact:'
      : 'The latest ruling, already woven into the page it ruled on:';
    line.textContent = 'The house has ruled: ' + verdict.words.trim();
    line.hidden = false;
  });

  render();
  return wrap;
}

/* ---------- what's true of them (M6 — the canon store) ---------- */

function canonPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'canon-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';

  const form = document.createElement('form');
  form.className = 'present-form ledger-form';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.maxLength = 60;
  nameInput.placeholder = 'Who?';
  nameInput.setAttribute('aria-label', 'Whose truth this is');
  const keyInput = document.createElement('input');
  keyInput.type = 'text';
  keyInput.maxLength = 40;
  keyInput.placeholder = 'What it’s called — hair, eyes, a limp';
  keyInput.setAttribute('aria-label', 'What the truth is called');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.maxLength = 140;
  valueInput.placeholder = 'What’s true — black, grey, from the war';
  valueInput.setAttribute('aria-label', 'What’s true of them');
  const addBtn = document.createElement('button');
  addBtn.type = 'submit';
  addBtn.className = 'text-btn';
  addBtn.textContent = 'Lock it in';
  form.append(nameInput, keyInput, valueInput, addBtn);

  wrap.append(note, list, form);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    const key = keyInput.value.trim();
    const value = valueInput.value.trim();
    if (!name || !key || !value) return;
    nameInput.value = keyInput.value = valueInput.value = '';
    await handMutate(ctx, [{ type: 'canon.lock', name, key, value }]);
    render();
  });

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose truths these are.';
      form.hidden = true;
      return;
    }
    form.hidden = false;
    const state = await loadState(story.id);
    const canon = state.canon && typeof state.canon === 'object' ? state.canon : {};
    const names = Object.keys(canon).filter((n) => canon[n]
      && Array.isArray(canon[n].facts) && canon[n].facts.length);
    note.textContent = names.length
      ? 'Locked truths — the story treats these as simply so, and the second reader checks each page against them.'
      : 'Nothing is locked yet. When something about a person is simply so — hair: black; eyes: grey — write it down here and the story will hold to it.';
    for (const name of names) {
      for (const fact of canon[name].facts) {
        const li = document.createElement('li');
        li.className = 'present-row';
        const words = document.createElement('span');
        words.textContent = name + ' — ' + fact.key + ': ' + fact.value;
        const out = document.createElement('button');
        out.type = 'button';
        out.className = 'story-mini';
        out.title = 'No longer certain';
        out.setAttribute('aria-label', `“${fact.key}” is no longer locked for ${name}`);
        out.textContent = '×';
        out.addEventListener('click', async () => {
          await handMutate(ctx, [{ type: 'canon.unlock', name, key: fact.key }]);
          render();
        });
        li.append(words, out);
        list.appendChild(li);
      }
    }
  });

  render();
  return wrap;
}

/* ---------- how they measure (M11 — the referee's cast sheet) ---------- */

/* The sheet the referee rules from: each named soul's standing (0–10),
 * the domains they're known for, and what ails them (lasting conditions).
 * The referee and its seeder keep these numbers; the panel reads them
 * plainly and never invents one that isn't written down. */
function measurePanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'measure-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';
  wrap.append(note, list);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know who stands on these scales.';
      return;
    }
    const state = await loadState(story.id);
    const sheet = state.sheet && typeof state.sheet === 'object' ? state.sheet : { actors: {}, playerName: '' };
    const names = Object.keys(sheet.actors || {});
    if (!names.length) {
      note.textContent = 'No one is weighed yet. Once the referee has ruled on a chancy moment — or the tale has found its footing — the cast’s measure is written here, 0 to 10.';
      return;
    }
    note.textContent = 'How the house weighs each of them, 0 to 10 — what they’re known for, and what ails them. The referee rules from these numbers.';
    for (const name of names) {
      const actor = sheet.actors[name];
      if (!actor || typeof actor !== 'object') continue;
      const li = document.createElement('li');
      li.className = 'present-row measure-row';
      const words = document.createElement('span');
      const standing = Number.isFinite(actor.default) ? actor.default : 5;
      words.textContent = name + (isMc(state, name) ? ' (you)' : '') + ' — ' + standing + ' of 10';
      li.appendChild(words);
      const extras = [];
      const domains = actor.domains && typeof actor.domains === 'object' ? actor.domains : {};
      const domainBits = Object.entries(domains).map(([d, v]) => d + ' ' + v);
      if (domainBits.length) extras.push('known for ' + domainBits.join(', '));
      if (Array.isArray(actor.conditions) && actor.conditions.length) {
        extras.push(actor.conditions.map((c) => c.name + (c.mod ? ' (' + (c.mod > 0 ? '+' : '') + c.mod + ')' : '')).join('; '));
      }
      if (extras.length) {
        const small = document.createElement('small');
        small.textContent = extras.join(' — ');
        li.appendChild(small);
      }
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- something drifted (M6 — the continuity reader's notes) ------ */

function driftPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'drift-editor';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'log-list';
  wrap.append(note, list);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the second reader will know which pages to mind.';
      return;
    }
    /* Findings live on the assistant messages they were read from; the
     * panel gathers the newest few, windowed to the last 100 pages (M9,
     * B18 — a long tale's early drift is old news). */
    const history = await db.messages.list(story.id);
    const window = history.slice(-100);
    const found = [];
    for (let i = window.length - 1; i >= 0 && found.length < 10; i -= 1) {
      const msg = window[i];
      if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.findings)) continue;
      for (let j = msg.findings.length - 1; j >= 0 && found.length < 10; j -= 1) {
        const f = msg.findings[j];
        if (f && typeof f.words === 'string' && f.words.trim()) {
          found.push({ words: f.words.trim(), severity: f.severity === 'warn' ? 'warn' : 'note' });
        }
      }
    }
    /* M41: the auditor's last report leads */
    const stateNow = await loadState(story.id);
    const audit = stateNow && stateNow.audit;
    if (audit && Array.isArray(audit.issues)) {
      const head = document.createElement('li');
      head.className = 'log-row';
      head.textContent = audit.issues.length
        ? 'The auditor’s last reading of the whole ledger (turn ' + audit.turn + '):'
        : 'The auditor’s last reading (turn ' + audit.turn + '): the ledger is true to the story.';
      list.appendChild(head);
      for (const i of audit.issues) {
        const li = document.createElement('li');
        li.className = 'log-row' + (i.fixable ? '' : ' drift-warn');
        li.textContent = (i.fixable ? 'Set right: ' : 'Noted, not fixable by the ledger: ') + i.what + (i.fix ? ' → ' + i.fix : '');
        list.appendChild(li);
      }
    }
    /* M43: the pages the reader mended, with the earlier words a tap away */
    const mended = history.slice(-100).filter((m) => m && m.role === 'assistant' && m.mended && m.mended.before).reverse().slice(0, 6);
    for (const m of mended) {
      const li = document.createElement('li');
      li.className = 'log-row';
      const words = document.createElement('span');
      words.textContent = 'Mended a page' + (m.mended.why ? ' — ' + m.mended.why : '') + '. ';
      const back = document.createElement('button');
      back.type = 'button';
      back.className = 'text-btn';
      back.textContent = 'Put the earlier words back';
      back.addEventListener('click', async () => {
        if (ctx.chat && typeof ctx.chat.unmend === 'function') await ctx.chat.unmend(m.id);
        render();
      });
      li.append(words, back);
      list.appendChild(li);
    }
    if (!found.length && !mended.length) {
      note.textContent = 'Nothing has drifted. When a finished page disagrees with what’s written down, the reader mends it and notes it here.';
      return;
    }
    if (!found.length) { note.textContent = 'What the reader mended; the earlier words are a tap away.'; return; }
    note.textContent = 'Where recent pages sat awkwardly beside what’s written down. Newest first; the words themselves were left as written.';
    for (const f of found) {
      const li = document.createElement('li');
      li.className = 'log-row' + (f.severity === 'warn' ? ' drift-warn' : '');
      const words = document.createElement('span');
      words.textContent = (f.severity === 'warn' ? 'Drifted: ' : 'Worth a look: ') + f.words;
      li.appendChild(words);
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- the panels ---------- */

/* The workers' ledger line (M9, SPEC §5 — background work is quiet in the
 * story but never silent in the ledger; M10 added the housekeeper's
 * household to the names). One row per worker: its last run, whether it
 * ended well, and one plain word of why not when it didn't. */
/* ---------- the world beyond the page (M29 — the world agent's book) ---------- */

function worldPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'world-panel';
  const note = quietNote('');
  const briefBox = document.createElement('div');
  briefBox.className = 'world-brief';
  const threadsHead = quietNote('Threads');
  const threads = document.createElement('ul');
  threads.className = 'present-list';
  const knowHead = quietNote('Who knows what');
  const know = document.createElement('ul');
  know.className = 'present-list';
  const facHead = quietNote('Factions');
  const fac = document.createElement('ul');
  fac.className = 'present-list';
  wrap.append(note, briefBox, threadsHead, threads, knowHead, know, facHead, fac);

  const line = (text, cls) => {
    const p = document.createElement('p');
    p.className = cls || 'quiet';
    p.textContent = text;
    return p;
  };

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    briefBox.textContent = '';
    threads.textContent = '';
    know.textContent = '';
    fac.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the world beyond its page will keep its book here.';
      threadsHead.hidden = knowHead.hidden = facHead.hidden = true;
      return;
    }
    const state = await loadState(story.id);
    const brief = state.worldBrief;
    const turnNow = Number.isFinite(state.turn) ? state.turn : 0;
    if (!brief || brief.empty) {
      note.textContent = brief
        ? 'The world agent read the last page and found nothing pressing on this scene — a quiet turn, honestly kept.'
        : 'The world agent has not spoken yet. After a page is finished it moves the absent by the clock and leaves the world’s word here.';
    } else {
      const age = Number.isFinite(brief.atTurn) ? Math.max(0, turnNow - brief.atTurn) : 0;
      note.textContent = 'The world’s word — what the storyteller will be told about the world beyond this page' + (age > 1 ? ' (written ' + age + ' turns ago)' : '') + ':';
      if (brief.pressure.length) {
        briefBox.appendChild(line('Could reach this scene:', 'quiet'));
        for (const p of brief.pressure) briefBox.appendChild(line('• ' + p, 'world-line'));
      }
      if (brief.ripe.length) {
        briefBox.appendChild(line('Ripened out of sight:', 'quiet'));
        for (const r of brief.ripe) briefBox.appendChild(line('• ' + r, 'world-line'));
      }
      if (brief.twb) {
        briefBox.appendChild(line('A window beyond, if the scene has room: ' + [brief.twb.who, brief.twb.where].filter(Boolean).join(', ') + ' — ' + brief.twb.changed, 'world-line'));
      }
    }

    /* threads, with a hand "let it rest" (thread.close rides the log like any change) */
    const list = Array.isArray(state.threads) ? state.threads.filter((t) => t && typeof t === 'object' && t.title) : [];
    threadsHead.hidden = !list.length;
    for (const t of list) {
      const li = document.createElement('li');
      li.className = 'present-row mind-row';
      const words = document.createElement('span');
      words.textContent = (t.heat === 'cold' ? '(cold) ' : '') + t.title
        + (t.owner ? ' — ' + t.owner : '') + (t.next ? (t.owner ? ' means to ' : ' — next: ') + t.next : '');
      const closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'text-btn';
      closeBtn.textContent = 'Let it rest';
      closeBtn.addEventListener('click', async () => {
        await handMutate(ctx, [{ type: 'thread.close', title: t.title }]);
        render();
      });
      li.append(words, closeBtn);
      threads.appendChild(li);
    }

    /* who knows what — the present */
    const present = Array.isArray(state.present) ? state.present.map((p) => p && p.name).filter(Boolean) : [];
    const knowledge = state.knowledge && typeof state.knowledge === 'object' ? state.knowledge : {};
    const knowRows = [];
    for (const name of present) {
      const key = Object.keys(knowledge).find((k) => k.trim().toLowerCase() === name.trim().toLowerCase());
      if (!key || !Array.isArray(knowledge[key]) || !knowledge[key].length) continue;
      knowRows.push(key + ' knows: ' + knowledge[key].slice(-4).reverse().map((k) => k.fact).join('; '));
    }
    knowHead.hidden = !knowRows.length;
    for (const text of knowRows) {
      const li = document.createElement('li');
      li.className = 'log-row';
      li.textContent = text;
      know.appendChild(li);
    }

    /* factions */
    const factions = state.factions && typeof state.factions === 'object' ? state.factions : {};
    const facNames = Object.keys(factions).filter((n) => factions[n] && typeof factions[n] === 'object');
    facHead.hidden = !facNames.length;
    for (const name of facNames) {
      const f = factions[name];
      const li = document.createElement('li');
      li.className = 'log-row';
      li.textContent = name + ' — ' + [f.stance, f.agenda ? 'wants ' + f.agenda : '', f.move ? 'last move: ' + f.move : ''].filter(Boolean).join('; ');
      fac.appendChild(li);
    }
  });

  render();
  return wrap;
}

/* ---------- the people (M40 — the character ledger, visible) ---------- */

function peoplePanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'people-panel';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'present-list';
  wrap.append(note, list);
  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) { note.textContent = 'Open a story and every character’s page will be here.'; return; }
    const state = await loadState(story.id);
    const chars = state.characters && typeof state.characters === 'object' ? state.characters : {};
    const names = Object.keys(chars).filter((n) => chars[n] && typeof chars[n] === 'object');
    if (!names.length) { note.textContent = 'No character pages yet. The scribe writes one for everyone who acts on a page; the world agent for everyone it seats.'; return; }
    note.textContent = names.length + (names.length === 1 ? ' page' : ' pages') + ' — who each person is (core), how they are now (state), how they stand with the main character (arc), and their loose ends.';
    const present = new Set((state.present || []).map((p) => String(p && p.name || '').toLowerCase()));
    names.sort((a, b) => (present.has(b.toLowerCase()) - present.has(a.toLowerCase())) || a.localeCompare(b));
    for (const name of names) {
      const c = chars[name];
      const li = document.createElement('li');
      li.className = 'present-row mind-row people-row';
      const head = document.createElement('strong');
      head.textContent = name + (present.has(name.toLowerCase()) ? ' — here' : (state.offscreen && Object.keys(state.offscreen).some((k) => k.toLowerCase() === name.toLowerCase()) ? ' — elsewhere' : ''));
      li.appendChild(head);
      for (const [label, key] of [['Core', 'core'], ['Now', 'state'], ['Arc', 'arc']]) {
        if (typeof c[key] === 'string' && c[key].trim()) {
          const p = document.createElement('div');
          p.className = 'quiet';
          p.textContent = label + ': ' + c[key].trim();
          li.appendChild(p);
        }
      }
      if (Array.isArray(c.threads) && c.threads.length) {
        const p = document.createElement('div');
        p.className = 'quiet';
        p.textContent = 'Loose ends: ' + c.threads.map((t) => (typeof t === 'string' ? t : t && t.text)).filter(Boolean).join('; ');
        li.appendChild(p);
      }
      list.appendChild(li);
    }
  });
  render();
  return wrap;
}

/* ---------- the workers' line (M12) ---------- */
const WORKER_WORDS = {
  founder: 'the founder',
  extractor: 'the extractor',
  world: 'the world agent',
  scribe: 'the scribe',
  keeper: 'the keeper',
  referee: 'the referee',
  continuity: 'the second reader',
  auditor: 'the auditor',
  housekeeper: 'the housekeeper',
  director: 'the director',
  editor: 'the editor',
};

function workersPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'workers-panel';
  const note = quietNote('');
  const list = document.createElement('ul');
  list.className = 'log-list';
  /* M40: read the pages again — by hand, when something looks missing */
  const rescan = document.createElement('button');
  rescan.type = 'button';
  rescan.className = 'text-btn';
  rescan.textContent = 'Read the pages again';
  rescan.title = 'The workers read the latest page again, with the eight before it in view, and write what they find.';
  rescan.addEventListener('click', async () => {
    if (ctx.chat && typeof ctx.chat.rescanLedger === 'function') await ctx.chat.rescanLedger();
  });
  /* M41: audit the ledger — the whole of it against the brief, the pages and the record */
  const audit = document.createElement('button');
  audit.type = 'button';
  audit.className = 'text-btn';
  audit.textContent = 'Audit the ledger';
  audit.title = 'The auditor holds the whole ledger against the brief, the latest pages and the record, sets right what it can, and notes the rest.';
  audit.addEventListener('click', async () => {
    if (ctx.chat && typeof ctx.chat.auditNow === 'function') await ctx.chat.auditNow();
  });
  /* M45: found the world from the brief, the cast, the cards and the lore */
  const found = document.createElement('button');
  found.type = 'button';
  found.className = 'text-btn';
  found.textContent = 'Found the world from the brief';
  found.title = 'The founder reads the brief, the cast notes, the invited cards and the lore, and writes every named person, bond, appearance, faction, seat and thread they establish into the ledger.';
  found.addEventListener('click', async () => {
    if (ctx.chat && typeof ctx.chat.foundNow === 'function') await ctx.chat.foundNow();
  });
  const row = document.createElement('div');
  row.className = 'row';
  row.append(found, rescan, audit);
  wrap.append(note, row, list);

  const render = latestWins(async () => {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the workers will keep their honest line here.';
      return;
    }
    const shelf = await loadWorkerStatus(story.id);
    /* M46: what is reading right now, first */
    const live = runningWorkers(story.id);
    for (const name of live) {
      const li = document.createElement('li');
      li.className = 'log-row worker-live';
      li.textContent = (WORKER_WORDS[name] || name) + ' is reading now…';
      list.appendChild(li);
    }
    for (const b of [found, rescan, audit]) b.disabled = false;
    if (live.includes('founder')) { found.disabled = true; found.textContent = 'Founding…'; } else found.textContent = 'Found the world from the brief';
    if (live.includes('auditor')) { audit.disabled = true; audit.textContent = 'Auditing…'; } else audit.textContent = 'Audit the ledger';
    if (live.includes('extractor') || live.includes('world')) { rescan.disabled = true; rescan.textContent = 'Reading…'; } else rescan.textContent = 'Read the pages again';
    const seen = WORKER_NAMES.filter((name) => shelf[name]);
    if (!seen.length && !live.length) {
      note.textContent = 'No worker has run yet. When one does — a reading of the ledger, a weighing of a page — its last run is noted here, well or ill.';
      return;
    }
    note.textContent = live.length ? 'Reading now — the line lands here the moment it is done:' : 'Background work is quiet in the story but never silent here. Each worker’s last run:';
    for (const name of seen) {
      const row = shelf[name];
      const li = document.createElement('li');
      li.className = 'log-row';
      const words = document.createElement('span');
      const when = fmtWhenWords(row.at);
      words.textContent = (WORKER_WORDS[name] || name) + ' ran ' + when
        + (row.ok ? (' and it went well' + (row.detail ? ' — ' + row.detail : '') + '.')
                  : ' and stumbled — ' + (row.why || 'stumbled') + '.');
      li.appendChild(words);
      /* M31: what it actually said, folded — so "could not be used" can be
       * read instead of guessed at. */
      if (row.raw) {
        const fold = document.createElement('details');
        fold.className = 'worker-said';
        const sum = document.createElement('summary');
        sum.className = 'lbl';
        sum.textContent = 'what it said';
        const pre = document.createElement('pre');
        pre.className = 'worker-raw';
        pre.textContent = row.raw;
        fold.append(sum, pre);
        li.appendChild(fold);
      }
      list.appendChild(li);
    }
  });

  render();
  return wrap;
}

const PANELS = [
  {
    id: 'the-clock',
    title: 'The clock',
    render: (ctx) => clockPanel(ctx),
  },
  {
    id: 'the-ruling',
    title: 'The house has ruled',
    render: (ctx) => verdictPanel(ctx),
  },
  {
    id: 'how-they-measure',
    title: 'How they measure',
    render: (ctx) => measurePanel(ctx),
  },
  {
    id: 'whos-here',
    title: 'Who’s here',
    render: (ctx) => whosHerePanel(ctx),
  },
  {
    id: 'whats-true',
    title: 'What’s true of them',
    render: (ctx) => canonPanel(ctx),
  },
  {
    id: 'holding-up',
    title: 'How they’re holding up',
    render: (ctx) => holdingUpPanel(ctx),
  },
  {
    id: 'on-their-mind',
    title: 'On their mind',
    render: (ctx) => onTheirMindPanel(ctx),
  },
  {
    id: 'elsewhere',
    title: 'What’s happening elsewhere',
    render: (ctx) => elsewherePanel(ctx),
  },
  {
    id: 'the-world-beyond',
    title: 'The world beyond the page',
    render: (ctx) => worldPanel(ctx),
  },
  {
    id: 'the-mood',
    title: 'The mood of the scene',
    render: (ctx) => moodPanel(ctx),
  },
  {
    id: 'what-changed',
    title: 'What changed and why',
    render: (ctx) => logPanel(ctx),
  },
  {
    id: 'something-drifted',
    title: 'Something drifted',
    render: (ctx) => driftPanel(ctx),
  },
  {
    id: 'the-people',
    title: 'The people',
    render: (ctx) => peoplePanel(ctx),
  },
  {
    id: 'the-workers',
    title: 'The workers',
    render: (ctx) => workersPanel(ctx),
  },
];

export function initDrawer(ctx) {
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('drawer-scrim');
  const panelsEl = document.getElementById('drawer-panels');
  const btnClose = document.getElementById('btn-drawer-close');

  let unsubscribe = null;

  function render() {
    /* Re-point the live subscription at whichever story is active now. */
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    const storyId = ctx.getActiveStoryId();
    if (storyId) {
      unsubscribe = subscribe(storyId, () => {
        if (!drawer.hidden) render();
      });
    }

    panelsEl.textContent = '';
    for (const panel of PANELS) {
      const section = document.createElement('section');
      section.className = 'ledger-panel';
      section.dataset.panel = panel.id;

      const h = document.createElement('h3');
      h.textContent = panel.title;
      section.appendChild(h);

      if (typeof panel.render === 'function') {
        const node = panel.render(ctx);
        if (node) section.appendChild(node);
      } else {
        const p = document.createElement('p');
        p.textContent = panel.body;
        section.appendChild(p);
      }
      panelsEl.appendChild(section);
    }
  }

  /* M46: the drawer follows the workers as they start and settle — one
   * subscription for the whole drawer, never one per panel render. */
  onWorkerChange(() => { if (!drawer.hidden) render(); });

  function open() {
    render();
    drawer.hidden = false;
    scrim.hidden = false;
    /* let the browser notice we're visible before sliding in */
    requestAnimationFrame(() => drawer.classList.add('open'));
    /* M14: the header keeps the ember on the room that's open. */
    const btn = document.getElementById('btn-ledger');
    if (btn) btn.classList.add('current');
  }

  /* B8 (M9): the close timer carries a generation number — a close
   * followed quickly by an open no longer hides the drawer out from under
   * the reopen. */
  let closeGeneration = 0;

  function close() {
    const generation = ++closeGeneration;
    drawer.classList.remove('open');
    scrim.hidden = true;
    const btn = document.getElementById('btn-ledger');
    if (btn) btn.classList.remove('current');
    setTimeout(() => {
      if (generation !== closeGeneration) return; // reopened in between
      drawer.hidden = true;
    }, 200);
  }

  function toggle() {
    if (drawer.hidden) open(); else close();
  }

  btnClose.addEventListener('click', close);
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !drawer.hidden) close();
  });

  ctx.drawer = { open, close, toggle };
}
