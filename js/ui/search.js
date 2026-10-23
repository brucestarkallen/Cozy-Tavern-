/* Cozy Tavern — the shelf's search (M622).
 *
 * "Search inside your tales" at the top of the story panel. As he types (a short pause, two letters at least), every
 * tale on his shelf is searched by default, regardless of collapsed or archived folders.
 * M734 adds explicit multiple-folder selection using stored project/giant membership, not rendered rows.
 * The tales searched are: the ones this browser holds from their own pages (the freshest copy), the ones only
 * the device holds through the device (api/books/search — the browser keeps only what it has opened, M313). The
 * tales stand newest-played first, each with its places newest page first; a tap on a place opens the tale at that
 * page, however far back it stands. An empty box, or Escape, brings the shelf back. */
import { db, messagesMark } from '../store.js';
import { indexPages, searchIndex, dress, searchKey, SEARCH_MIN } from '../engine/search.js';

const SHOWN = 3; /* places shown per tale before "Show all" */
/* M768: each tale's pages made into an index once — read again only when that tale's pages changed (store.js messagesMark) */
const indexes = new Map();
const reading = new Map(); /* a tale being read for its index, so two askers share one reading */
async function taleIndex(storyId) {
  const mark = messagesMark(storyId);
  const held = indexes.get(storyId);
  if (held && held.mark === mark) return held.pages;
  const out = reading.get(storyId);
  if (out && out.mark === mark) return out.promise;
  const promise = db.messages.list(storyId, { keep: false }).then((rows) => {
    const pages = indexPages(rows);
    if (messagesMark(storyId) === mark) indexes.set(storyId, { mark, pages }); /* a write while it read: not kept */
    return pages;
  }).finally(() => { if (reading.get(storyId)?.promise === promise) reading.delete(storyId); });
  reading.set(storyId, { mark, promise });
  return promise;
}

export function initStorySearch(ctx) {
  const input = document.getElementById('story-search');
  const box = document.getElementById('search-results');
  const list = document.getElementById('story-list');
  const empty = document.getElementById('story-list-empty');
  if (!input || !box || !list) return null;

  let seq = 0;
  let timer = null;
  let deviceAsk = null; /* M768: the device's search still out */
  const scopeControl = document.getElementById('search-scope');
  const folderBox = document.getElementById('search-folders');
  const folderOptions = document.getElementById('search-folder-options');
  const selected = new Set();
  let folderSeq = 0;
  async function drawFolders() {
    const draw = ++folderSeq;
    const [projects, giants] = await Promise.all([db.projects.list(), db.giants.list()]);
    if (draw !== folderSeq) return;
    const giantNames = new Map(giants.map(g => [g.id, g.name]));
    const choices = [
      ...giants.map(g => ['giant:' + g.id, 'Large project: ' + g.name + (g.archived ? ' (archived)' : '')]),
      ...projects.map(p => ['project:' + p.id, (giantNames.get(p.giantId) ? giantNames.get(p.giantId) + ' / ' : '') + p.name + (p.archived ? ' (archived)' : '')]),
      ['loose', 'Loose stories']
    ];
    folderOptions.replaceChildren();
    for (const [id, name] of choices) {
      const label = document.createElement('label');
      const check = document.createElement('input');
      check.type = 'checkbox'; check.value = id; check.checked = selected.has(id);
      check.addEventListener('change', () => {
        if (check.checked) selected.add(id); else selected.delete(id);
        launch(input.value);
      });
      label.append(check, document.createTextNode(name)); folderOptions.append(label);
    }
  }
  function launch(value) {
    clearTimeout(timer);
    const pending = run(value);
    const request = seq;
    pending.catch(() => {
      if (request !== seq) return;
      box.replaceChildren(line('Search could not finish. Please try again.'));
      box.hidden = false;
    });
  }
  scopeControl.addEventListener('change', () => {
    folderBox.hidden = scopeControl.value !== 'selected';
    if (!folderBox.hidden) drawFolders().catch(() => { folderOptions.textContent = 'Folders could not load. Please try again.'; });
    launch(input.value);
  });

  function closeResults() {
    seq += 1;
    if (deviceAsk) { deviceAsk.abort(); deviceAsk = null; }
    box.hidden = true;
    box.textContent = '';
    list.hidden = false;
    if (empty) empty.hidden = list.children.length > 0;
  }

  function line(text, cls) {
    const p = document.createElement('p');
    p.className = cls || 'quiet';
    p.textContent = text;
    return p;
  }

  function placeButton(tale, hit) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'search-hit-row';
    const who = document.createElement('span');
    who.className = 'lbl search-who';
    who.textContent = hit.role === 'user' ? 'You' : 'The story';
    const words = document.createElement('span');
    words.className = 'search-words';
    const mark = document.createElement('mark');
    mark.textContent = hit.match;
    words.append(document.createTextNode(hit.before || ''), mark, document.createTextNode(hit.after || ''));
    b.append(who, words);
    b.setAttribute('aria-label', `Open “${tale.title}” at this page`);
    b.addEventListener('click', () => {
      if (ctx.chat && typeof ctx.chat.jumpToPage === 'function') ctx.chat.jumpToPage(tale.id, hit.id).catch(() => { box.prepend(line('This page could not open. Please try again.')); });
    });
    return b;
  }

  function taleCard(tale) {
    const card = document.createElement('div');
    card.className = 'search-tale';
    const head = document.createElement('div');
    head.className = 'search-tale-head';
    const title = document.createElement('span');
    title.className = 'search-tale-title';
    title.textContent = tale.title || 'Untitled';
    const count = document.createElement('span');
    count.className = 'lbl';
    count.textContent = (tale.shelf ? tale.shelf + ' · ' : '') + (tale.count === 1 ? 'one place' : tale.count + ' places');
    head.append(title, count);
    card.appendChild(head);
    const rows = document.createElement('div');
    rows.className = 'search-hits';
    const kept = () => (tale.places ? tale.places.length : tale.hits.length); /* M768: the places found, words read or not */
    const draw = (all) => {
      rows.textContent = '';
      for (const hit of (all ? tale.hits : tale.hits.slice(0, SHOWN))) rows.appendChild(placeButton(tale, hit));
      if (!all && kept() > SHOWN) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'text-btn';
        more.textContent = 'Show all ' + kept() + (tale.count > kept() ? ' of ' + tale.count : '');
        more.addEventListener('click', async () => {
          /* M768: the rest of the places read from their pages now — only when he asks for them */
          if (tale.places && tale.hits.length < tale.places.length) {
            more.disabled = true;
            try {
              const rest = tale.places.slice(tale.hits.length);
              const found = await db.messages.byIds(rest.map((h) => h.id));
              tale.hits = [...tale.hits, ...rest.filter((h) => found.has(h.id)).map((h) => dress(h, found.get(h.id).text, tale.key)).filter(Boolean)];
            } catch (err) { more.disabled = false; rows.appendChild(line('These places could not load. Please try again.')); return; }
          }
          draw(true);
        });
        rows.appendChild(more);
      } else if (all && tale.count > kept()) {
        rows.appendChild(line('…and ' + (tale.count - kept()) + ' more in this tale — a longer phrase narrows them.'));
      }
    };
    draw(false);
    card.appendChild(rows);
    return card;
  }

  async function run(raw) {
    const my = ++seq;
    const key = searchKey(raw);
    if (key.length < SEARCH_MIN) { closeResults(); return; }
    list.hidden = true;
    if (empty) empty.hidden = true;
    box.hidden = false;
    box.textContent = '';
    box.appendChild(line('Searching your tales for “' + raw.trim() + '”…'));
    const everyTale = (await db.stories.list()).filter((s) => s && !(s.building && typeof s.building === 'object'));
    const [projects, giants] = await Promise.all([db.projects.list(), db.giants.list()]);
    if (my !== seq) return;
    const narrowed = scopeControl.value === 'selected';
    const projectMap = new Map(projects.map(p => [p.id, p]));
    const giantNames = new Map(giants.map(g => [g.id, g.name]));
    const shelf = narrowed ? everyTale.filter(st => {
      if (!st.projectId) return selected.has('loose');
      const project = projectMap.get(st.projectId);
      return selected.has('project:' + st.projectId) || (project && selected.has('giant:' + project.giantId));
    }) : everyTale;
    const shelfNames = new Map(projects.map(p => [p.id, (giantNames.get(p.giantId) ? giantNames.get(p.giantId) + ' / ' : '') + p.name]));
    const shelfOf = (st) => (st.projectId && shelfNames.get(st.projectId)) || 'Loose tales';
    const local = new Map();
    /* M768: the device is asked at once, beside the browser's own reading, and a search he has typed past is called off */
    if (deviceAsk) deviceAsk.abort();
    const ask = (shelf.some((s) => s.shallow) && ctx && ctx.booksStatus && ctx.booksStatus.backed) ? new AbortController() : null;
    deviceAsk = ask;
    const fromDevice = ask ? fetch(new URL('api/books/search?q=' + encodeURIComponent(key), document.baseURI), { cache: 'no-store', signal: ask.signal })
      .then((res) => (res.ok ? res.json() : null)).catch(() => null) : null;
    const held = shelf.filter((st) => !st.shallow); /* a shallow tale's pages are on the device, not here */
    let readSoFar = 0;
    const progress = box.firstChild;
    for (const st of held) {
      if (!indexes.has(st.id) || indexes.get(st.id).mark !== messagesMark(st.id)) {
        readSoFar += 1;
        if (progress && readSoFar % 5 === 0) progress.textContent = 'Searching your tales for “' + raw.trim() + '”… (' + local.size + ' of ' + held.length + ')';
      }
      local.set(st.id, searchIndex(await taleIndex(st.id), key));
      if (my !== seq) return;
    }
    let remote = [];
    let deviceSilent = false;
    /* M675: the device is asked only when the tavern's server stands behind this page — the words he searches for are
     * never sent to a host that is not it (a shelf row with no pages can also come from a partial copy brought back) */
    if (shelf.some((s) => s.shallow) && !ask) deviceSilent = true;
    else if (ask) {
      const body = await fromDevice;
      if (body && Array.isArray(body.results)) remote = body.results; else deviceSilent = true;
    }
    if (my !== seq) return;
    /* M768: the places found take their words from their own pages — read only those (a few a tale), never the tales whole */
    const wanted = [...local.values()].flatMap((r) => r.hits.slice(0, SHOWN).map((h) => h.id)); /* the rest when he asks to see all */
    const rows = wanted.length ? await db.messages.byIds(wanted) : new Map();
    if (my !== seq) return;
    for (const [id, r] of local) local.set(id, { count: r.count, places: r.hits, key, hits: r.hits.slice(0, SHOWN).filter((h) => rows.has(h.id)).map((h) => dress(h, rows.get(h.id).text, key)).filter(Boolean) });
    const byId = new Map(shelf.map((s) => [s.id, s]));
    const results = [];
    for (const st of shelf) {
      const r = local.get(st.id);
      if (r && r.count) results.push({ id: st.id, title: st.title, shelf: shelfOf(st), updatedAt: st.updatedAt || 0, count: r.count, hits: r.hits, places: r.places, key: r.key });
    }
    for (const r of remote) {
      const st = r && byId.get(r.id);
      if (!st || local.has(r.id) || !(r.count > 0) || !Array.isArray(r.hits)) continue; /* a tale not on his shelf is not shown */
      results.push({ id: st.id, title: st.title, shelf: shelfOf(st), updatedAt: st.updatedAt || r.updatedAt || 0, count: r.count, hits: r.hits });
    }
    results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); /* the latest tale first */
    box.textContent = '';
    const where = narrowed ? ' in the selected folders' : '';
    if (narrowed && !selected.size) { box.appendChild(line('Choose one or more folders to search.')); return; }
    box.appendChild(line(results.length
      ? (results.length === 1 ? 'One tale' + where + ' holds' : results.length + ' tales' + where + ' hold') + ' “' + raw.trim() + '” — the latest first.'
      : 'No tale' + where + ' holds “' + raw.trim() + '”.', 'lbl search-summary'));
    /* M675: …and when the tavern answered that it does not serve this address, that is what is said — not that it "did not answer" */
    const turnedAway = Boolean(ctx && ctx.booksStatus && !ctx.booksStatus.backed && ctx.booksStatus.refused);
    if (deviceSilent) box.appendChild(line(turnedAway
      ? 'Only the tales this browser holds were searched — the tavern is running, but it does not answer under this address (Settings says how to start it so that it does).'
      : 'Only the tales this browser holds were searched — the device did not answer for the rest.'));
    for (const tale of results) box.appendChild(taleCard(tale));
  }

  /* M768: the moment he steps into the box, the tales' indexes are made while he types — the first search finds them ready */
  let warming = null;
  input.addEventListener('focus', () => {
    if (warming) return;
    warming = (async () => {
      const tales = (await db.stories.list()).filter((s) => s && !s.shallow && !(s.building && typeof s.building === 'object'));
      for (const st of tales) await taleIndex(st.id);
    })().catch(() => {}).finally(() => { warming = null; });
  });
  input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = input.value;
    timer = setTimeout(() => { launch(value); }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; clearTimeout(timer); closeResults(); }
    if (e.key === 'Enter') { clearTimeout(timer); launch(input.value); }
  });

  /* M629 (the session's audit): results standing while a tale is deleted, renamed or moved went stale — a tap on a deleted
   * tale's place led nowhere; the house's word that the shelf changed searches again */
  const refresh = () => { if (!folderBox.hidden) drawFolders().catch(() => {}); if (!box.hidden && searchKey(input.value).length >= SEARCH_MIN) launch(input.value); };
  const api = { run: (q) => { input.value = q; return run(q); }, close: () => { input.value = ''; closeResults(); }, refresh };
  if (ctx) ctx.search = api;
  return api;
}
