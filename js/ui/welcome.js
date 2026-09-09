/* Cozy Tavern — ui/welcome.js
 * The welcome mat (M13). The first time the tavern opens, a host at the
 * door — three warm steps, no more: add a connection, bring what's yours
 * (or start bare), write the first line. It shows ONCE (the settings flag
 * `welcomeSeen`), every step can be stepped out of ("Enough — let me in"),
 * and it comes back whenever asked from Settings ("The guided tour").
 * Step three offers "learn more" — the "How the tavern works" sheet, the
 * whole model in plain words.
 *
 * The tour's state machine is pure and exported (createTour), so the
 * harness can walk it without a DOM. The DOM wiring lives in initWelcome.
 */

import { db } from '../store.js';

export const WELCOME_SEEN_KEY = 'welcomeSeen';

/* The three steps, worded like a host at the door. `target` is where the
 * step's button takes the writer ('settings' deep-links, null just
 * advances). */
export const TOUR_STEPS = [
  {
    title: 'First, a storyteller',
    body: 'The tavern needs a voice to answer yours. Add a connection — a key for Claude, OpenAI, OpenRouter, or any compatible address. It stays on this device and goes nowhere else.',
    button: 'Add a connection',
    target: 'settings',
  },
  {
    title: 'Bring what’s yours — or start bare',
    body: 'An engine preset, character cards, a lorebook, old chats: the tavern reads them all, here on this device, and nothing is uploaded. Or bring nothing at all — a blank page is a fine beginning.',
    button: 'See what you can bring',
    target: 'settings',
  },
  {
    title: 'Write the first line',
    /* M16: the last step names the housekeeper, so finding it later never
     * depends on luck. */
    body: 'Say what happens, or ask for a scene — the tavern opens a story around your words. After the answer arrives, the small “receipt” line under it shows exactly what the storyteller saw. And the housekeeper keeps the tale tidy — find it up top.',
    button: 'Begin',
    target: null,
    more: true, /* offers the "How the tavern works" sheet */
  },
];

/* The pure state machine: three steps forward, a way back, a way out.
 * finish() is how every exit lands — dismissed or walked to the end. */
export function createTour() {
  let index = 0;
  let done = false;
  return {
    get index() { return index; },
    get done() { return done; },
    step() { return done ? null : TOUR_STEPS[index]; },
    next() {
      if (done) return null;
      if (index < TOUR_STEPS.length - 1) index += 1;
      else done = true;
      return done ? null : TOUR_STEPS[index];
    },
    back() {
      if (!done && index > 0) index -= 1;
      return done ? null : TOUR_STEPS[index];
    },
    finish() { done = true; },
    /* The guided tour from Settings: the walk starts over from the top. */
    restart() { index = 0; done = false; },
  };
}

/* The once-law: the welcome shows only until the flag is written, and the
 * guided tour (from Settings) re-opens it without touching the flag's
 * meaning — it simply stays seen. */
export async function welcomeShouldShow() {
  try {
    return (await db.settings.get(WELCOME_SEEN_KEY)) !== true;
  } catch (err) {
    return false;
  }
}

export async function markWelcomeSeen() {
  try {
    await db.settings.set(WELCOME_SEEN_KEY, true);
  } catch (err) { /* a flag that won't write just means one more hello */ }
}

/* ---------- the DOM ---------- */

export function initWelcome(ctx) {
  const overlay = document.getElementById('welcome-overlay');
  const title = document.getElementById('welcome-title');
  const body = document.getElementById('welcome-body');
  const stepsLine = document.getElementById('welcome-steps');
  const btnNext = document.getElementById('btn-welcome-next');
  const btnBack = document.getElementById('btn-welcome-back');
  const btnEnough = document.getElementById('btn-welcome-enough');
  const btnMore = document.getElementById('btn-welcome-more');
  const howSheet = document.getElementById('how-sheet');
  const btnHowClose = document.getElementById('btn-how-close');
  if (!overlay || !title || !btnNext) return;

  const tour = createTour();

  function renderStep() {
    const step = tour.step();
    if (!step) { close(); return; }
    title.textContent = step.title;
    body.textContent = step.body;
    stepsLine.textContent = 'step ' + (tour.index + 1) + ' of ' + TOUR_STEPS.length;
    btnNext.textContent = step.button;
    btnBack.hidden = tour.index === 0;
    btnMore.hidden = !step.more;
  }

  function open() {
    renderStep();
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('open'));
    btnNext.focus();
  }

  function close() {
    overlay.classList.remove('open');
    setTimeout(() => { overlay.hidden = true; }, 200);
  }

  async function dismiss() {
    tour.finish();
    close();
    await markWelcomeSeen();
  }

  btnNext.addEventListener('click', async () => {
    const step = tour.step();
    if (!step) return;
    if (step.target === 'settings') {
      /* a deep-link into the room the step speaks of; the tour resumes
       * when they come back — it waits where it was */
      location.hash = '#/settings';
      overlay.classList.remove('open');
      setTimeout(() => { overlay.hidden = true; }, 200);
      return;
    }
    /* the last step's button walks out through the door */
    await dismiss();
  });

  btnBack.addEventListener('click', () => { tour.back(); renderStep(); });
  btnEnough.addEventListener('click', () => { dismiss(); });
  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') dismiss();
  });

  /* Resumable: a step that deep-linked into Settings waits there, and the
   * tour picks up where it left off when the writer comes back to the
   * story floor — unless it was properly dismissed (or already seen). */
  window.addEventListener('hashchange', () => {
    if (location.hash === '#/settings' || tour.done || !overlay.hidden) return;
    welcomeShouldShow().then((show) => { if (show) open(); });
  });

  /* The "How the tavern works" sheet — reachable from the tour's last step
   * and from Settings. */
  const howScrim = document.getElementById('how-scrim');
  function openHow() {
    if (!howSheet) return;
    howSheet.hidden = false;
    if (howScrim) howScrim.hidden = false;
    requestAnimationFrame(() => howSheet.classList.add('open'));
  }
  function closeHow() {
    if (!howSheet) return;
    howSheet.classList.remove('open');
    setTimeout(() => {
      howSheet.hidden = true;
      if (howScrim) howScrim.hidden = true;
    }, 200);
  }
  if (btnMore) btnMore.addEventListener('click', openHow);
  if (btnHowClose) btnHowClose.addEventListener('click', closeHow);
  if (howScrim) howScrim.addEventListener('click', closeHow);

  /* Settings offers the way back in ("The guided tour") and the sheet. */
  const btnTour = document.getElementById('btn-guided-tour');
  if (btnTour) {
    btnTour.addEventListener('click', async () => {
      location.hash = '#/';
      /* The walk starts over from the top. M15 audit: this used to assign
       * to the machine's getter-only `done` — a TypeError that left the
       * button dead. restart() is the machine's own way back. */
      tour.restart();
      if (ctx && ctx.drawer && typeof ctx.drawer.close === 'function') ctx.drawer.close();
      open();
      await markWelcomeSeen();
    });
  }
  const btnHow = document.getElementById('btn-how-it-works');
  if (btnHow) btnHow.addEventListener('click', openHow);

  /* The once-law, honored at the door. */
  welcomeShouldShow().then((show) => { if (show) open(); });

  ctx.welcome = { open, openHow };
}
