/* Cozy Tavern — ui/drawer.js
 * The right-hand slide-over: "The story's ledger".
 * M2: the "Who's here" panel is real — it lists who is present in the scene
 * (state.present) and lets you write names in and out by hand, until the M3
 * engine starts keeping the ledger itself. The other panels stay data-driven
 * stubs. To wire real data into a panel, give it a `render(ctx)` that
 * returns a node — the shell below doesn't change.
 */

import { loadState, saveState } from '../engine/state.js';
import { db } from '../store.js';

/* A name may carry a she/her mark — "Mira (she/her)" — which one of the
 * house rules listens for (see the acoustics predicate in modules.js). */
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

  async function currentStory() {
    const id = ctx.getActiveStoryId();
    return id ? db.stories.get(id) : undefined;
  }

  async function render() {
    const story = await currentStory();
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
      name.textContent = entry.name;
      const out = document.createElement('button');
      out.type = 'button';
      out.className = 'story-mini';
      out.title = 'They step out';
      out.setAttribute('aria-label', `${entry.name} steps out of the scene`);
      out.textContent = '×';
      out.addEventListener('click', async () => {
        const fresh = await loadState(story.id);
        fresh.present = (fresh.present || []).filter((p) => p.name !== entry.name);
        await saveState(story.id, fresh);
        render();
      });
      li.append(name, out);
      list.appendChild(li);
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const story = await currentStory();
    if (!story) return;
    const name = input.value.trim();
    if (!name) return;
    const state = await loadState(story.id);
    state.present = Array.isArray(state.present) ? state.present : [];
    if (!state.present.some((p) => p.name === name)) {
      state.present.push({ name });
      await saveState(story.id, state);
    }
    input.value = '';
    render();
  });

  render();
  return wrap;
}

const PANELS = [
  {
    id: 'whos-here',
    title: 'Who’s here',
    render: (ctx) => whosHerePanel(ctx),
  },
  {
    id: 'the-clock',
    title: 'The clock',
    body: 'Coming as the engine wakes up.',
  },
  {
    id: 'on-their-mind',
    title: 'On their mind',
    body: 'Coming as the engine wakes up.',
  },
];

export function initDrawer(ctx) {
  const drawer = document.getElementById('drawer');
  const scrim = document.getElementById('drawer-scrim');
  const panelsEl = document.getElementById('drawer-panels');
  const btnClose = document.getElementById('btn-drawer-close');

  function render() {
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
