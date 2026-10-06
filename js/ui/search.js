/* Cozy Tavern — the shelf's search (M622).
 *
 * "Search inside your tales" at the top of the story panel. As he types (a short pause, two letters at least), every
 * tale on his shelf is searched: the ones this browser holds from their own pages (the freshest copy), the ones only
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
      if (ctx.chat && typeof ctx.chat.jumpToPage === 'function') ctx.chat.jumpToPage(tale.id, hit.id).catch(() => {});
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
    count.textContent = tale.count === 1 ? 'one place' : tale.count + ' places';
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
    const shelf = (await db.stories.list()).filter((s) => s && !(s.building && typeof s.building === 'object'));
    const local = new Map();
    for (const st of shelf) {
      if (st.shallow) continue; /* its pages are on the device, not here */
      local.set(st.id, searchPages(await db.messages.list(st.id), key));
      if (my !== seq) return;
    }
    let remote = [];
    let deviceSilent = false;
    if (shelf.some((s) => s.shallow)) {
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
      if (r && r.count) results.push({ id: st.id, title: st.title, updatedAt: st.updatedAt || 0, count: r.count, hits: r.hits });
    }
    for (const r of remote) {
      const st = r && byId.get(r.id);
      if (!st || local.has(r.id) || !(r.count > 0) || !Array.isArray(r.hits)) continue; /* a tale not on his shelf is not shown */
      results.push({ id: st.id, title: st.title, updatedAt: st.updatedAt || r.updatedAt || 0, count: r.count, hits: r.hits });
    }
    results.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)); /* the latest tale first */
    box.textContent = '';
    box.appendChild(line(results.length
      ? (results.length === 1 ? 'One tale holds' : results.length + ' tales hold') + ' “' + raw.trim() + '” — the latest first.'
      : 'No tale holds “' + raw.trim() + '”.', 'lbl search-summary'));
    if (deviceSilent) box.appendChild(line('Only the tales this browser holds were searched — the device did not answer for the rest.'));
    for (const tale of results) box.appendChild(taleCard(tale));
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const value = input.value;
    timer = setTimeout(() => { run(value).catch(() => {}); }, 300);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; clearTimeout(timer); closeResults(); }
    if (e.key === 'Enter') { clearTimeout(timer); run(input.value).catch(() => {}); }
  });

  const api = { run: (q) => { input.value = q; return run(q); }, close: () => { input.value = ''; closeResults(); } };
  if (ctx) ctx.search = api;
  return api;
}
