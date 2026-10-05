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

export const NOTE_ADDS_KEY = 'noteAdds';

function uid() { return 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

export function cleanNoteAdds(list) {
  return (Array.isArray(list) ? list : [])
    .filter((n) => n && typeof n === 'object')
    .map((n) => ({ id: typeof n.id === 'string' && n.id ? n.id : uid(), on: n.on !== false, text: typeof n.text === 'string' ? n.text : '' }));
}

export async function loadNoteAdds() { return cleanNoteAdds(await db.settings.get(NOTE_ADDS_KEY)); }

export function initNoteAdds(ctx) {
  const list = document.getElementById('note-adds-list');
  const draft = document.getElementById('note-add-text');
  const addBtn = document.getElementById('btn-note-add');
  if (!list || !draft || !addBtn) return null;

  let entries = [];

  async function save() {
    await db.settings.set(NOTE_ADDS_KEY, entries.map((n) => ({ id: n.id, on: n.on !== false, text: String(n.text || '') })));
  }

  function card(entry) {
    const box = document.createElement('div');
    box.className = 'note-add-card' + (entry.on ? '' : ' is-off');
    box.dataset.id = entry.id;

    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = entry.on !== false;
    on.setAttribute('aria-label', 'Send this note');
    on.title = 'Send this note';
    on.addEventListener('change', async () => {
      entry.on = on.checked;
      box.classList.toggle('is-off', !on.checked);
      await save();
    });

    const text = document.createElement('textarea');
    text.rows = 2;
    text.spellcheck = false;
    text.value = entry.text;
    text.setAttribute('aria-label', 'This note');

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
    keep.addEventListener('click', async () => {
      entry.text = text.value;
      await save();
      kept.hidden = false;
      setTimeout(() => { kept.hidden = true; }, 1600);
    });
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
    row.append(keep, letGo, kept);

    const head = document.createElement('div');
    head.className = 'note-add-head';
    head.append(on, text);
    box.append(head, row);
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
      if (entry && t && t.value !== entry.text) { entry.text = t.value; moved = true; }
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
