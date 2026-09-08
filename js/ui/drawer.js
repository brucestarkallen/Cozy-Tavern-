/* Cozy Tavern — ui/drawer.js
 * The right-hand slide-over: "The story's ledger". M3 woke it up: the clock
 * keeps the hour, Who's here carries position and attire when known, the
 * mood of the scene reads its flags in plain words, and "What changed and
 * why" reads the log the applier writes — newest first, each change
 * take-back-able. M4 filled the last panels: "How they're holding up" (the
 * body ledger), "On their mind" (the standings between people, real now),
 * and "What's happening elsewhere" (the off-screen world). Hand controls go
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
import { db } from '../store.js';

/* ---------- shared helpers ---------- */

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

/* ---------- the clock ---------- */

function clockPanel(ctx) {
  const wrap = document.createElement('div');
  wrap.className = 'clock-editor';

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

  async function render() {
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
  }

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
  wrap.append(list, note, form);

  async function render() {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose scene this is.';
      form.hidden = true;
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
  }

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

  async function render() {
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
  }

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

  async function render() {
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
  }

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

  async function render() {
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
  }

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

  async function render() {
    const story = await currentStory(ctx);
    list.textContent = '';
    if (!story) {
      note.textContent = 'Open a story and the ledger will know whose hearts these are.';
      form.hidden = true;
      return;
    }
    form.hidden = false;
    const state = await loadState(story.id);
    const rel = state.relationships && typeof state.relationships === 'object' ? state.relationships : {};
    const names = Object.keys(rel).filter((n) => rel[n] && typeof rel[n] === 'object');
    note.textContent = names.length
      ? 'How they stand toward the main character — warmth, pull, charge. Nothing moves without a cause.'
      : 'No standings written yet. Feelings are only written down when something on the page earns it.';
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
  }

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

  async function render() {
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
  }

  render();
  return wrap;
}

/* ---------- the panels ---------- */

const PANELS = [
  {
    id: 'the-clock',
    title: 'The clock',
    render: (ctx) => clockPanel(ctx),
  },
  {
    id: 'whos-here',
    title: 'Who’s here',
    render: (ctx) => whosHerePanel(ctx),
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
    id: 'the-mood',
    title: 'The mood of the scene',
    render: (ctx) => moodPanel(ctx),
  },
  {
    id: 'what-changed',
    title: 'What changed and why',
    render: (ctx) => logPanel(ctx),
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

  function open() {
    render();
    drawer.hidden = false;
    scrim.hidden = false;
    /* let the browser notice we're visible before sliding in */
    requestAnimationFrame(() => drawer.classList.add('open'));
  }

  function close() {
    drawer.classList.remove('open');
    scrim.hidden = true;
    setTimeout(() => { drawer.hidden = true; }, 200);
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
