/* Cozy Tavern — ui/drawer.js
 * The right-hand slide-over: "The story's ledger".
 * M1 panels are data-driven stubs; the engine fills them with real scene
 * state in M3–M4. To wire real data later, give a panel a `render()` that
 * returns a node — the shell below doesn't change.
 */

const PANELS = [
  {
    id: 'whos-here',
    title: 'Who’s here',
    body: 'Coming as the engine wakes up.',
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
