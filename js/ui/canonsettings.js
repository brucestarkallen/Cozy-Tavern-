/* Cozy Tavern — js/ui/canonsettings.js
 * M386: EVERY LEVER OF CANON VERIFICATION, IN SETTINGS. M346 showed the writer one switch and one box ("it's literally just
 * one box"); his extension's own panel has every lever below. They are drawn here from the extension's own settings
 * object (the live one it reads every turn — a change is in force on the next page, no refresh) and written back through
 * it, so there is ONE copy of each setting and one meaning for each control. What belongs to one story — its wiki, its
 * notes, its pins and blocks, where it stands in canon, everything looked up — lives in that story's ledger room, "What
 * canon says"; what is here holds for every story.
 * Named as his extension names them (Cast Auditor, Smart dynamic order, Per-pair dynamics, Prose briefs, Smarter AI,
 * ✒ Advanced, LLM-curated dossiers, Parser self-test), each with its plain meaning. Drawn only with the switch on: off,
 * the extension is never loaded. */
import {
  canonMeta, canonSettings, setCanonSetting as setCanonSettingOf, canonDefaults, canonLibrary, addToLibrary, removeFromLibrary, canonPromptDefault, canonResetKeywords, canonResetAll,
} from '../canon/bridge.js';

/* [key, label, what it means] — the extension's own toggles */
const FINDING = [
  ['llmParser', 'A model reads who is in the scene (recommended)', 'Your worker connection names the canon people, places and events a page is about, with the words that prove each. Off: capitalised names are guessed at.'],
  ['parserEveryTurn', 'Read the scene on every page', 'Off, it reads the scene when your message or a new name gives it a reason.'],
  ['useLedger', 'Use the story’s own ledger (recommended)', 'Everyone “Who’s here” has in the scene rides with the page, named or not, and the ledger’s people count as the story’s real cast.'],
  ['lowercaseNames', 'Lowercase names count too', 'So “you talk to rukia” still names her.'],
  ['castAuditor', 'Cast Auditor 🛡', 'A second look before a name the model quoted weakly is trusted.'],
  ['groundFromReplies', 'Look up whoever the storyteller brings in', 'After each page, anyone it introduced is looked up for the next one.'],
  ['autoDiscoverWiki', 'Find each story’s wiki by itself 🔭', 'From your brief and the names in it; a story whose wiki you name keeps yours.'],
  ['debug', 'Tell me what it is doing', 'A short message each time it reads, looks up or holds a page.'],
];
const SAYING = [
  ['physical', 'How they look', ''],
  ['personality', 'How they are', ''],
  ['relationship', 'Family and ties', ''],
  ['biography', 'Their story', ''],
  ['abilities', 'What they can do', ''],
  ['trivia', 'Trivia', ''],
  ['voice', 'How they talk (their own lines from canon)', 'Heard for the cadence, never repeated.'],
  ['llmDossier', 'LLM-curated dossiers ✦', 'A model reads each person’s whole page once and writes who they are, their facts, powers, secrets and voice.'],
  ['proseBriefs', 'Prose briefs 📝', 'Who they are in a few sentences instead of a list.'],
  ['dynamicNote', 'Smart dynamic order 🌊', 'What this scene needs of each person comes first.'],
  ['relationDynamics', 'Per-pair dynamics', 'Who they are to each other person in the scene — the “With …” lines.'],
  ['smartExpansion', 'Smarter AI 🧠', 'The places, groups and things around them ride too.'],
  ['reportUnverified', 'Say what is NOT in canon ⌀', 'A name the story asks about that no wiki page has is said plainly, so nothing is borrowed for it.'],
  ['arcInject', 'Where our story is rides too', 'The canon arc the story stands in — what has happened and what has not.'],
  ['autoArc', 'It follows the story by itself 📖', 'A page that begins a canon event moves where our story is.'],
  ['composerMode', '✒ Advanced — a model writes it as flowing prose', 'Its facts are checked against what was looked up before it may be used; on the pages where canon changes, the page waits for it.'],
];
/* [key, label, unit, min, max, step, stored-as-ms] */
const NUMBERS = [
  ['contextWindow', 'Pages that count as the scene now', '', 1, 100, 1, false],
  ['maxCharacters', 'At most this many people at once', '', 1, 30, 1, false],
  ['maxTokensPerChar', 'Tokens for each of them', '', 20, 500, 10, false],
  ['maxTotalTokens', 'Tokens for all of them together', '', 150, 5000, 25, false],
  ['parserBudgetMs', 'How long the model may take to read a scene', 'seconds', 10, 180, 5, true],
  ['maxBlockMs', 'How long a page may wait for it', 'seconds', 0.5, 60, 0.5, true],
  ['firstMeetWaitMs', '…when someone new is met', 'seconds', 2, 60, 1, true],
  ['composeWaitMs', '…for the ✒ Advanced prose', 'seconds', 2, 60, 1, true],
];
const WORDS = [
  ['promptHeader', 'The words before what canon says (your storyteller reads these)'],
  ['promptParser', 'How the scene is read'],
  ['promptDossier', 'How a dossier is written'],
  ['promptAuditor', 'The Cast Auditor’s look'],
  ['promptArcJudge', 'How it tells where our story is'],
  ['promptDiscover', 'How it finds a story’s wiki'],
  ['promptAsk', 'How “Ask canon” reads you'],
];
const KEYWORDS = [
  ['fields', 'How a face is written on a wiki page (infobox fields)'],
  ['relationshipKeywords', 'Family and ties'],
  ['biographyKeywords', 'Their story'],
  ['personalityKeywords', 'How they are'],
  ['abilitiesKeywords', 'What they can do'],
  ['quoteKeywords', 'Their own lines'],
  ['aliasKeywords', 'Other names'],
];

function el(tag, props = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') n.textContent = v;
    else if (k === 'className') n.className = v;
    else n.setAttribute(k, v);
  }
  for (const k of kids) if (k) n.appendChild(k);
  return n;
}
function quiet(text) { return el('p', { className: 'quiet', text }); }

/* Draw every lever into `host`. `selfTest` asks through the open story's canon worker (ctx.chat.canonTest). */
export async function drawCanonControls(host, { selfTest, storyId, act } = {}) {
  if (!host) return;
  /* M457: these are the OPEN story's own settings — each story keeps its own */
  const s = await canonSettings(storyId);
  const setCanonSetting = (key, value) => setCanonSettingOf(key, value, storyId);
  const defaults = await canonDefaults();
  host.textContent = '';

  const toggle = ([key, label, meaning]) => {
    const box = el('input', { type: 'checkbox', id: 'canon-' + key });
    box.checked = s[key] === true;
    box.addEventListener('change', async () => { await setCanonSetting(key, box.checked); });
    const row = el('div', { className: 'row' }, el('label', { className: 'radio-row' }, box, document.createTextNode(' ' + label)));
    return meaning ? [row, quiet(meaning)] : [row];
  };
  const group = (title, lead, nodes) => {
    const fold = el('details', { className: 'canon-group' });
    fold.appendChild(el('summary', { text: title }));
    if (lead) fold.appendChild(quiet(lead));
    for (const n of nodes.flat()) if (n) fold.appendChild(n);
    host.appendChild(fold);
    return fold;
  };

  /* how it finds the people */
  const said = quiet('');
  said.id = 'canon-selftest-said';
  const testBtn = el('button', { type: 'button', className: 'text-btn', id: 'canon-selftest', text: '🔬 Parser self-test' });
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    said.textContent = 'Asking through this story’s canon worker…';
    try {
      const r = typeof selfTest === 'function' ? await selfTest() : { ok: false, ms: 0, error: 'open a story first' };
      said.textContent = r && r.ok ? 'It answered in ' + r.ms + ' ms — “' + r.reply + '”.' : 'It did not answer (' + ((r && r.error) || 'no reply') + ').';
    } catch (err) {
      said.textContent = 'It did not answer (' + String((err && err.message) || err).slice(0, 120) + ').';
    } finally { testBtn.disabled = false; }
  });
  group('How it finds the people in a scene', 'Its model calls go through your worker connection (Settings → The workers → Canon verification).',
    [...FINDING.map(toggle), el('div', { className: 'row' }, testBtn), said]);

  /* what it says of them */
  group('What it says of them', '', SAYING.map(toggle));

  /* how much, how long */
  const numbers = NUMBERS.map(([key, label, unit, min, max, step, asMs]) => {
    const input = el('input', { type: 'number', id: 'canon-' + key, min: String(min), max: String(max), step: String(step) });
    const now = Number(s[key]);
    const fallback = Number(defaults[key]);
    input.value = String(asMs ? (Number.isFinite(now) ? now : fallback) / 1000 : (Number.isFinite(now) ? now : fallback));
    input.addEventListener('change', async () => {
      const v = Number(input.value);
      if (!Number.isFinite(v)) { input.value = String(asMs ? fallback / 1000 : fallback); return; }
      const clamped = Math.min(max, Math.max(min, v));
      input.value = String(clamped);
      await setCanonSetting(key, asMs ? Math.round(clamped * 1000) : Math.round(clamped));
    });
    return el('label', { className: 'stack-label' }, document.createTextNode(label + (unit ? ' (' + unit + ')' : '') + ' '), input);
  });
  group('How much rides, and how long a page waits', 'The page is never held longer than these; what is not ready in time rides with the next page.', numbers);

  /* M457: THE LIBRARY — the wikis every story can pick from in its own room ("This story's wiki"); a story's own wiki is
   * set there, never here: where to look is each story's own, and an empty one finds itself or skips */
  const libIn = el('input', { type: 'text', id: 'canon-library-add', maxlength: '200', placeholder: 'e.g. bleach -- from bleach.fandom.com' });
  const libAdd = el('button', { type: 'button', className: 'text-btn', id: 'canon-library-add-btn', text: 'Add to library' });
  const library = el('div', { className: 'canon-library', id: 'canon-library' });
  /* M463: A WIKI IN THE LIBRARY IS A SWITCH FOR THIS STORY. He: "one tap what? I can't tap anything … and can't do
   * crossovers". The rows were plain text, and the story's own room REPLACED its wiki with the one tapped. Now a tap adds the
   * wiki to where this story looks, or takes it away — two or more at once is a crossover (the extension's binding is a
   * list) — and the line above says where this story looks now. */
  /* M464: AUTOMATIC IS A CHOICE YOU CAN SEE AND TAP. He: "you give me a way to select but no way to deselect all, so I
   * can't tell it to look automatically". Letting go of the last wiki did send it back to finding its own — and the wiki
   * it found came back with a check, as though he had picked it. The extension marks his choices (canon_grounding_wiki_ok
   * .manual); what it found by itself is not his pick. Now "Automatic" is a button of its own, checked when the story
   * finds its own wiki (and saying which it found), and a wiki is checked only when he chose it. */
  const where = async () => {
    const meta = storyId ? ((await canonMeta(storyId)) || {}) : {};
    const list = String(meta.canon_grounding_wiki || '').split(',').map((w) => w.trim()).filter(Boolean);
    const manual = Boolean(meta.canon_grounding_wiki_ok && meta.canon_grounding_wiki_ok.manual);
    return { manual, picked: manual ? list : [], found: manual ? [] : list };
  };
  const inUse = async () => (await where()).picked;
  const drawLibrary = async () => {
    library.textContent = '';
    const list = await canonLibrary();
    const w0 = await where();
    const using = w0.picked;
    library.appendChild(quiet(w0.manual && using.length ? 'This story looks in: ' + using.join(' + ') + (using.length > 1 ? ' (a crossover)' : '') + ', as you chose.'
      : w0.found.length ? 'Automatic -- it found this story\'s wiki by itself: ' + w0.found.join(' + ') + '.' : 'Automatic -- nothing fits yet; it looks again as the story names people and places, and skips until then.'));
    const auto = el('button', { type: 'button', className: 'lib-chip' + (!w0.manual ? ' current' : ''), id: 'canon-lib-auto', 'aria-pressed': !w0.manual ? 'true' : 'false', text: (!w0.manual ? '✓ ' : '') + 'Automatic' });
    auto.addEventListener('click', async () => { if (typeof act !== 'function' || !w0.manual) return; auto.disabled = true; try { await act('wiki', ''); } finally { await drawLibrary(); } });
    library.appendChild(el('div', { className: 'present-row' }, auto));
    if (!list.length) { library.appendChild(quiet('The library is empty -- add a wiki above, or each one a story finds is kept here.')); return; }
    library.appendChild(quiet('Or choose: tap a wiki to use it in this story -- tap more than one for a crossover, tap again to stop (the last one off is Automatic again):'));
    for (const w of list) {
      const on = using.includes(w);
      const pick = el('button', { type: 'button', className: 'lib-chip' + (on ? ' current' : ''), id: 'canon-lib-use-' + w, 'aria-pressed': on ? 'true' : 'false', text: (on ? '✓ ' : '') + w });
      pick.addEventListener('click', async () => {
        if (typeof act !== 'function') return;
        const now = await inUse();
        const next = now.includes(w) ? now.filter((x) => x !== w) : [...now, w];
        pick.disabled = true;
        try { await act('wiki', next.join(',')); } finally { await drawLibrary(); }
      });
      const x = el('button', { type: 'button', className: 'story-mini', title: 'Take ' + w + ' out of the library', 'aria-label': 'Take ' + w + ' out of the library', text: 'x' });
      x.addEventListener('click', async () => { await removeFromLibrary(w); await drawLibrary(); });
      library.appendChild(el('div', { className: 'present-row' }, pick, x));
    }
  };
  libAdd.addEventListener('click', async () => { if (!libIn.value.trim()) return; await addToLibrary(libIn.value); libIn.value = ''; await drawLibrary(); });
  await drawLibrary();
  group('Where it looks', 'Each story has its own: name it in the story\'s room ("What canon says"), or leave it empty and it finds it from the brief, the pages and the ledger -- and skips when nothing fits. These settings are this story\'s own.', [
    el('label', { className: 'stack-label', for: 'canon-library-add', text: 'Wiki library' }), el('div', { className: 'row' }, libIn, libAdd), library,
  ]);

  /* his notes for every story */
  const globalPin = el('textarea', { id: 'canon-notes-all', rows: '3', placeholder: 'Rules or facts for every story, always — each story’s own go in its room.' });
  globalPin.value = typeof s.pinnedGlobal === 'string' ? s.pinnedGlobal : '';
  globalPin.addEventListener('change', async () => { await setCanonSetting('pinnedGlobal', globalPin.value); });
  group('Your notes for every story', 'They ride with what canon says in every story, word for word.', [globalPin]);

  /* the words it uses */
  const wordNodes = [];
  for (const [key, label] of WORDS) {
    const def = await canonPromptDefault(key);
    const area = el('textarea', { id: 'canon-' + key, rows: key === 'promptHeader' ? '4' : '6' });
    area.value = (typeof s[key] === 'string' && s[key].trim()) ? s[key] : def;
    area.addEventListener('change', async () => {
      const v = area.value;
      await setCanonSetting(key, v.trim() === String(def).trim() ? '' : v);
    });
    const back = el('button', { type: 'button', className: 'text-btn', text: '↺ as it came' });
    back.addEventListener('click', async () => { area.value = def; await setCanonSetting(key, ''); });
    wordNodes.push(el('label', { className: 'stack-label', for: 'canon-' + key, text: label }), area, el('div', { className: 'row' }, back));
  }
  group('The words it uses', 'Each as it came until you change it; ↺ puts one back.', wordNodes);

  /* what it reads on a wiki page */
  const kwInputs = {};
  const kwNodes = KEYWORDS.map(([key, label]) => {
    const input = el('input', { type: 'text', id: 'canon-' + key });
    input.value = typeof s[key] === 'string' ? s[key] : '';
    input.addEventListener('change', async () => { await setCanonSetting(key, input.value); });
    kwInputs[key] = input;
    return el('label', { className: 'stack-label' }, document.createTextNode(label + ' '), input);
  });
  const kwReset = el('button', { type: 'button', className: 'text-btn', text: 'Put these back as they came' });
  kwReset.addEventListener('click', async () => {
    const fresh = await canonResetKeywords();
    for (const [key] of KEYWORDS) kwInputs[key].value = typeof fresh[key] === 'string' ? fresh[key] : '';
  });
  group('What it reads on a wiki page', 'The section names and infobox fields it looks for, comma-separated. A change reaches people looked up after it (a person’s “Look it up again” in the room reads them anew).', [...kwNodes, el('div', { className: 'row' }, kwReset)]);

  /* all of it, as it came */
  const resetAll = el('button', { type: 'button', className: 'text-btn', id: 'canon-reset-all', text: '♻ Put every canon setting back as it came' });
  resetAll.addEventListener('click', async () => {
    if (!window.confirm('Put every canon verification setting and instruction back as it came? What each story has looked up, its wiki, and your notes for every story are kept.')) return;
    await canonResetAll();
    await drawCanonControls(host, { selfTest, storyId, act });
  });
  host.appendChild(el('div', { className: 'row' }, resetAll));
}
