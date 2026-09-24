/* Cozy Tavern — words in the storyteller's own voice (M466).
 *
 * SillyTavern's prompt-manager entries, kept for the day he needs them: each
 * card is one entry — a switch, a name, whose words they are (the
 * storyteller's own = an assistant message; his = a user message; the house's
 * = a system message), one of three landmarks in the request (assemble/stack.js
 * OWN_WORDS_PLACES), and the words. The whole list is ONE settings row
 * ("ownWords"), read by chat.js gatherSettings at send time; off or empty, not
 * one byte of any request changes.
 *
 * The words are kept on "Keep it", never on every keystroke (a sync push can
 * land under a typing hand — M428's law); the switch and the two choices are
 * kept the moment they change. Letting an entry go asks first — it erases
 * words he wrote (M175's law). */
import { db } from '../store.js';
import { OWN_WORDS_PLACES } from '../assemble/stack.js';

const KEY = 'ownWords';
const ROLES = [
  ['teller', 'The storyteller’s own words (an assistant message)'],
  ['you', 'Your words (a user message)'],
  ['house', 'The house’s words (a system message)'],
];

function uid() { return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function clean(list) {
  return (Array.isArray(list) ? list : [])
    .filter((w) => w && typeof w === 'object')
    .map((w) => ({
      id: typeof w.id === 'string' && w.id ? w.id : uid(),
      on: w.on !== false,
      name: typeof w.name === 'string' ? w.name : '',
      role: ROLES.some(([r]) => r === w.role) ? w.role : 'teller',
      place: Object.prototype.hasOwnProperty.call(OWN_WORDS_PLACES, w.place) ? w.place : 'after-your-message',
      text: typeof w.text === 'string' ? w.text : '',
    }));
}

export async function loadOwnWords() { return clean(await db.settings.get(KEY)); }

export function initOwnWords(ctx) {
  const list = document.getElementById('own-words-list');
  const addBtn = document.getElementById('btn-own-words-add');
  if (!list || !addBtn) return null;

  let entries = [];

  async function save() {
    await db.settings.set(KEY, entries.map((w) => ({ ...w })));
  }

  function card(entry) {
    const box = document.createElement('div');
    box.className = 'own-words-card' + (entry.on ? '' : ' is-off');
    box.dataset.id = entry.id;

    const head = document.createElement('div');
    head.className = 'own-words-head';
    const onLabel = document.createElement('label');
    onLabel.className = 'radio-row own-words-on';
    const on = document.createElement('input');
    on.type = 'checkbox';
    on.checked = entry.on;
    on.setAttribute('aria-label', 'Send these words');
    onLabel.append(on, document.createTextNode(' On'));
    on.addEventListener('change', async () => { entry.on = on.checked; box.classList.toggle('is-off', !entry.on); await save(); });
    const name = document.createElement('input');
    name.type = 'text';
    name.maxLength = 60;
    name.className = 'own-words-name';
    name.placeholder = 'A name for these words — “Stay Iron Man”';
    name.setAttribute('aria-label', 'A name for these words');
    name.value = entry.name;
    head.append(onLabel, name);

    const choices = document.createElement('div');
    choices.className = 'own-words-choices';
    const roleLabel = document.createElement('label');
    roleLabel.textContent = 'Whose words';
    const role = document.createElement('select');
    role.setAttribute('aria-label', 'Whose words these are');
    for (const [value, words] of ROLES) { const o = document.createElement('option'); o.value = value; o.textContent = words; role.appendChild(o); }
    role.value = entry.role;
    role.addEventListener('change', async () => { entry.role = role.value; await save(); });
    roleLabel.appendChild(role);
    const placeLabel = document.createElement('label');
    placeLabel.textContent = 'Where they ride';
    const place = document.createElement('select');
    place.setAttribute('aria-label', 'Where these words ride in the request');
    for (const [value, words] of Object.entries(OWN_WORDS_PLACES)) { const o = document.createElement('option'); o.value = value; o.textContent = words.charAt(0).toUpperCase() + words.slice(1); place.appendChild(o); }
    place.value = entry.place;
    place.addEventListener('change', async () => { entry.place = place.value; await save(); });
    placeLabel.appendChild(place);
    choices.append(roleLabel, placeLabel);

    const text = document.createElement('textarea');
    text.rows = 4;
    text.spellcheck = false;
    text.placeholder = 'The words, as the storyteller would say them — “Right. {{teller}} here, still me: I keep the ledger’s facts and I talk like myself.”';
    text.setAttribute('aria-label', 'The words');
    text.value = entry.text;

    const actions = document.createElement('div');
    actions.className = 'row own-words-actions';
    const keep = document.createElement('button');
    keep.type = 'button';
    keep.className = 'btn';
    keep.textContent = 'Keep it';
    const kept = document.createElement('span');
    kept.className = 'quiet';
    kept.hidden = true;
    kept.textContent = 'Kept.';
    keep.addEventListener('click', async () => {
      entry.name = name.value.trim();
      entry.text = text.value;
      await save();
      kept.hidden = false;
      setTimeout(() => { kept.hidden = true; }, 1500);
    });
    const drop = document.createElement('button');
    drop.type = 'button';
    drop.className = 'text-btn';
    drop.textContent = 'Let these words go';
    drop.addEventListener('click', async () => {
      /* M175: it erases words he wrote — it asks first */
      if (typeof window !== 'undefined' && typeof window.confirm === 'function'
        && !window.confirm('Let these words go? “' + (entry.name || 'the unnamed entry') + '” is erased — there is no take-back.')) return;
      entries = entries.filter((w) => w.id !== entry.id);
      await save();
      render();
    });
    actions.append(keep, kept, drop);

    box.append(head, choices, text, actions);
    return box;
  }

  function render() {
    list.textContent = '';
    if (!entries.length) {
      const p = document.createElement('p');
      p.className = 'quiet';
      p.textContent = 'None yet. Add one when a teller starts slipping out of himself — a line or two in his own voice is usually enough.';
      list.appendChild(p);
      return;
    }
    for (const entry of entries) list.appendChild(card(entry));
  }

  addBtn.addEventListener('click', async () => {
    entries.push({ id: uid(), on: true, name: '', role: 'teller', place: 'after-your-message', text: '' });
    await save();
    render();
    const last = list.lastElementChild;
    const name = last && last.querySelector('.own-words-name');
    if (name) name.focus();
  });

  (async () => {
    entries = await loadOwnWords();
    render();
  })().catch(() => { render(); });

  const api = { reload: async () => { entries = await loadOwnWords(); render(); } };
  if (ctx) ctx.ownWords = api;
  return api;
}
