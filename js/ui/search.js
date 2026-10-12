/* Cozy Tavern — the shelf's search (M622).
 *
 * "Search inside your tales" at the top of the story panel. As he types (a short pause, two letters at least), every
 * tale on his shelf is searched by default, regardless of collapsed or archived folders.
 * M734 adds explicit multiple-folder selection using stored project/giant membership, not rendered rows.
 * The tales searched are: the ones this browser holds from their own pages (the freshest copy), the ones only
 * the device holds through the device (api/books/search — the browser keeps only what it has opened, M313). The
 * tales stand newest-played first, each with its places newest page first; a tap on a place opens the tale at that
 * page, however far back it stands. An empty box, or Escape, brings the shelf back. */
import { db } from '../store.js';
import { searchPages, searchKey, SEARCH_MIN } from '../engine/search.js';

const SHOWN = 3; /* places shown per tale before "Show all" */

export function initStorySearch(ctx) {
  const input = document.getElementById('story-search');
  const box = document.getElementById('search-results');
  const list = document.getElementById('story-list');
  const empty = document.getElementById('story-list-empty');
  if (!input || !box || !list) return null;

  let seq = 0;
  let timer = null;
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
    const draw = (all) => {
      rows.textContent = '';
      for (const hit of (all ? tale.hits : tale.hits.slice(0, SHOWN))) rows.appendChild(placeButton(tale, hit));
      if (!all && tale.hits.length > SHOWN) {
        const more = document.createElement('button');
        more.type = 'button';
        more.className = 'text-btn';
        more.textContent = 'Show all ' + tale.hits.length + (tale.count > tale.hits.length ? ' of ' + tale.count : '');
        more.addEventListener('click', () => draw(true));
        rows.appendChild(more);
      } else if (all && tale.count > tale.hits.length) {
        rows.appendChild(line('…and ' + (tale.count - tale.hits.length) + ' more in this tale — a longer phrase narrows them.'));
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
    for (const st of shelf) {
      if (st.shallow) continue; /* its pages are on the device, not here */
      local.set(st.id, searchPages(await db.messages.list(st.id), key));
      if (my !== seq) return;
    }
    let remote = [];
    let deviceSilent = false;
    /* M675: the device is asked only when the tavern's server stands behind this page — the words he searches for are
     * never sent to a host that is not it (a shelf row with no pages can also come from a partial copy brought back) */
    if (shelf.some((s) => s.shallow) && !(ctx && ctx.booksStatus && ctx.booksStatus.backed)) deviceSilent = true;
    else if (shelf.some((s) => s.shallow)) {
      try {
        const res = await fetch(new URL('api/books/search?q=' + encodeURIComponent(key), document.baseURI), { cache: 'no-store' });
        const body = res.ok ? await res.json() : null;
        if (body && Array.isArray(body.results)) remote = body.results; else deviceSilent = true;
      } catch (err) { deviceSilent = true; }
    }
    if (my !== seq) return;
    const byId = new Map(shelf.map((s) => [s.id, s]));
    const results = [];
    for (const st of shelf) {
      const r = local.get(st.id);
      if (r && r.count) results.push({ id: st.id, title: st.title, shelf: shelfOf(st), updatedAt: st.updatedAt || 0, count: r.count, hits: r.hits });
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
