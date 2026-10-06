/* Cozy Tavern — notes above the note at the end (M620).
 *
 * His word: "add a new section on notes so I can just easily add notes and it'll append above it". Each note he adds
 * rides in the note at the end, above his own note, in the order he added them — the newest just above his note. The
 * whole list is ONE settings row ("noteAdds"), read by chat.js gatherSettings at send time and laid by
 * assemble/stack.js; it rides only when the note does (Settings → "Send the note at the end", and the small-model
 * switch beside it), and a voice preset keeps it with the note (engine/voicepresets.js VOICE_FIELDS).
 *
 * "Add the note" adds; a note's words are kept on its own "Keep it", never on every keystroke (a sync push can land
 * under a typing hand — M428's law), and Settings' safety net keeps words typed and left (keepTyped — M611's law),
 * the add box's draft included. Its switch is kept the moment it changes. Letting a note go asks first — it erases
 * words he wrote (M175's law). */
import { db } from '../store.js';
import { HOUSE_COT, HOUSE_COT_ID, withHouseNote } from '../assemble/stack.js'; /* M622: the house's thinking note */

/* M623: where each note stands beside his note, and the role it goes as */
const PLACES = [['above', 'Above my note'], ['below', 'Below my note']];
const ROLES = [['', 'Like the note at the end'], ['system', 'A system message'], ['user', 'A user message']];

export const NOTE_ADDS_KEY = 'noteAdds';

function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function cleanNoteAdds(list) {
  return withHouseNote((Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n === 'object')
    .map((n) => ({ id: typeof n.id === 'string' && n.id ? n.id : uid(), on: n.on !== false, text: typeof n.text === 'string' ? n.text : '', place: n.place === 'below' ? 'below' : 'above', role: n.role === 'system' || n.role === 'user' ? n.role : '', ...(n.id === HOUSE_COT_ID ? { builtin: true } : {}) })));
}

export async function loadNoteAdds() { return cleanNoteAdds(await db.settings.get(NOTE_ADDS_KEY)); }

/* M622: the words a card shows — the house's thinking note shows the house's words until he writes his own */
const wordsOf = (entry) => (entry.id === HOUSE_COT_ID && !String(entry.text || '').trim() ? HOUSE_COT : String(entry.text || ''));
/* and what is kept: the house's words, untouched, are kept as none of his own — so a better house note reaches him */
const keptFrom = (entry, typed) => (entry.id === HOUSE_COT_ID && String(typed || '').trim() === HOUSE_COT.trim() ? '' : String(typed || ''));

export function initNoteAdds(ctx) {
  const list = document.getElementById('note-adds-list');
  const draft = document.getElementById('note-add-text');
  const addBtn = document.getElementById('btn-note-add');
  if (!list || !draft || !addBtn) return null;

  let entries = [];

  async function save() {
    await db.settings.set(NOTE_ADDS_KEY, entries.map((n) => ({ id: n.id, on: n.on !== false, text: String(n.text || ''), place: n.place === 'below' ? 'below' : 'above', role: n.role === 'system' || n.role === 'user' ? n.role : '', ...(n.id === HOUSE_COT_ID ? { builtin: true } : {}) })));
  }

  function card(entry) {
    const box = document.createElement('div');
    box.className = 'note-add-card' + (entry.on ? '' : ' is-off');
    box.dataset.id = entry.id;

    /* M623: the tick lives in a .radio-row label, as every other tick in Settings does — a bare one took the global
     * form rule's full width and squeezed the note's words into a column one letter wide */
    const onLabel = document.createElement('label');
    onLabel.className = 'radio-row note-add-on';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = entry.on !== false;
    on.setAttribute('aria-label', 'Send this note');
    onLabel.append(on, document.createTextNode(' Send it'));
    on.addEventListener('change', async () => {
      entry.on = on.checked;
      box.classList.toggle('is-off', !on.checked);
      await save();
    });

    const house = entry.id === HOUSE_COT_ID;
    const text = document.createElement('textarea');
    text.rows = house ? 8 : 2;
    text.spellcheck = false;
    text.value = wordsOf(entry);
    text.setAttribute('aria-label', house ? 'The house’s thinking note' : 'This note');

    const row = document.createElement('div');
    row.className = 'row note-add-actions';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn';
    keep.textContent = 'Keep it';
    const kept = document.createElement('span');
    kept.className = 'quiet';
    kept.hidden = true;
    kept.textContent = 'Kept.';
    let back = null; /* the house note's "Put back the house's words" — shown the moment its words are his */
    keep.addEventListener('click', async () => {
      entry.text = keptFrom(entry, text.value);
      await save();
      if (back) back.hidden = String(entry.text || '').trim() === '' && String(text.value || '').trim() === HOUSE_COT.trim(); /* M629/M631 */
      kept.hidden = false;
      setTimeout(() => { kept.hidden = true; }, 1600);
    });
    /* M622: he chooses where each note stands — before or after the others */
    const at = entries.indexOf(entry);
    const move = (to) => async () => {
      const from = entries.indexOf(entry);
      if (from < 0 || to < 0 || to >= entries.length) return;
      entries.splice(from, 1);
      entries.splice(to, 0, entry);
      await save();
      render();
    };
    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'story-mini';
    up.textContent = '▲';
    up.title = 'Move it up — before the note above';
    up.setAttribute('aria-label', 'Move this note up');
    up.disabled = at <= 0;
    up.addEventListener('click', () => { move(entries.indexOf(entry) - 1)().catch(() => {}); });
    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'story-mini';
    down.textContent = '▼';
    down.title = 'Move it down — after the note below';
    down.setAttribute('aria-label', 'Move this note down');
    down.disabled = at < 0 || at >= entries.length - 1;
    down.addEventListener('click', () => { move(entries.indexOf(entry) + 1)().catch(() => {}); });
    if (house) {
      /* the house's note is switched off, never let go; his own words for it can be put back to the house's */
      back = document.createElement('button');
      back.type = 'button';
      back.className = 'text-btn';
      back.textContent = 'Put back the house’s words';
      /* M631: shown the moment the words differ from the house's — typed, kept, or left by Settings closing — so an
       * accidental change is put right with one tap, before or after it is kept */
      const differs = () => String(entry.text || '').trim() !== '' || String(text.value || '').trim() !== HOUSE_COT.trim();
      back.hidden = !differs();
      text.addEventListener('input', () => { back.hidden = !differs(); });
      back.addEventListener('click', async () => {
        entry.text = '';
        text.value = HOUSE_COT;
        await save();
        render();
      });
      row.append(keep, up, down, back, kept);
    } else {
      const letGo = document.createElement('button');
      letGo.type = 'button';
      letGo.className = 'text-btn';
      letGo.textContent = 'Let it go';
      letGo.addEventListener('click', async () => {
        if (typeof window.confirm === 'function' && !window.confirm('Let this note go? Its words are erased.')) return;
        entries = entries.filter((n) => n.id !== entry.id);
        await save();
        render();
      });
      row.append(keep, up, down, letGo, kept);
    }

    const head = document.createElement('div');
    head.className = 'note-add-head';
    head.appendChild(onLabel);
    if (house) {
      const name = document.createElement('span');
      name.className = 'note-add-name';
      name.textContent = 'The house’s thinking note — a check the storyteller runs to itself before each page';
      head.appendChild(name);
    }
    /* M623: where it stands beside his note, and the role it goes as — kept the moment they change */
    const choices = document.createElement('div');
    choices.className = 'note-add-choices';
    const pick = (label, options, value, onChange) => {
      const wrap = document.createElement('label');
      wrap.textContent = label;
      const sel = document.createElement('select');
      for (const [v, words] of options) { const o = document.createElement('option'); o.value = v; o.textContent = words; sel.appendChild(o); }
      sel.value = value;
      sel.addEventListener('change', async () => { onChange(sel.value); await save(); });
      wrap.appendChild(sel);
      return wrap;
    };
    choices.append(
      pick('Where it stands', PLACES, entry.place === 'below' ? 'below' : 'above', (v) => { entry.place = v === 'below' ? 'below' : 'above'; }),
      pick('Sent as', ROLES, entry.role === 'system' || entry.role === 'user' ? entry.role : '', (v) => { entry.role = v === 'system' || v === 'user' ? v : ''; }),
    );
    box.append(head, text, choices, row);
    return box;
  }

  function render() {
    list.textContent = '';
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = 'None yet. A note added below rides right above the note at the end, every turn.';
      list.appendChild(p);
      return;
    }
    for (const entry of entries) list.appendChild(card(entry));
  }

  async function addFromDraft() {
    const words = String(draft.value || '').trim();
    if (!words) return false;
    entries.push({ id: uid(), on: true, text: words });
    draft.value = '';
    await save();
    render();
    return true;
  }

  addBtn.addEventListener('click', () => { addFromDraft().catch(() => {}); });

  /* Settings' safety net (keepUnsaved) asks here when Settings closes: a note's words changed and left, and a draft
   * typed into the add box and never added, are kept as their own buttons would keep them. */
  async function keepTyped() {
    let moved = false;
    for (const box of list.querySelectorAll('.note-add-card')) {
      const entry = entries.find((n) => n.id === box.dataset.id);
      const t = box.querySelector('textarea');
      if (entry && t && t.value !== wordsOf(entry)) { entry.text = keptFrom(entry, t.value); moved = true; }
    }
    if (moved) await save();
    const added = await addFromDraft();
    if (moved && !added) render();
    return moved || added;
  }

  async function reload() {
    entries = await loadNoteAdds();
    render();
  }

  reload().catch(() => { render(); });
  const api = { reload, keepTyped };
  if (ctx) ctx.noteAdds = api;
  return api;
}
