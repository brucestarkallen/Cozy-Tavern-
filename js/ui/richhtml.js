/* Cozy Tavern — ui/richhtml.js
 * M31: when a display-mode regex rule dresses the page in HTML (the way
 * SillyTavern's 🎨 scripts style a header or a tracker), the thread renders
 * it — through an allowlist, never innerHTML on the model's words.
 *
 * The law of the walk:
 *   - Only tags in ALLOWED_TAGS become elements. Anything else (script,
 *     iframe, img, a, form, …) is flattened to its text.
 *   - Only `style`, `class`, `open` (details) and `title` survive as
 *     attributes; every on* handler, href, src, id is dropped. A style that
 *     reaches out — url(), expression(), @import, javascript: — is dropped
 *     whole.
 *   - Text nodes go through the same inline renderer as plain prose
 *     (*emphasis*, **strong**, `code`), so the writer's conventions still
 *     read inside a styled box.
 *
 * `renderHtmlProse(text)` → DocumentFragment. Browser only (DOMParser);
 * the pure helpers (scrubStyle, ALLOWED_TAGS, looksHtml) are what the
 * harness holds to account.
 */

import { appendInline } from './prose.js';

export const ALLOWED_TAGS = new Set([
  'div', 'span', 'p', 'br', 'hr', 'b', 'i', 'u', 's', 'em', 'strong', 'small', 'sub', 'sup', 'mark',
  'details', 'summary', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'header', 'footer', 'figure', 'figcaption',
]);
const ALLOWED_ATTRS = new Set(['style', 'class', 'open', 'title']);
const REACHING = /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i;

/* Does this text carry a tag the thread would render? A lone '<' in prose
 * ("he said 3 < 4") is not a tag. */
export function looksHtml(text) {
  const src = String(text || '');
  const m = src.match(/<\s*\/?\s*([a-z][a-z0-9]*)[\s>\/]/gi);
  if (!m) return false;
  return m.some((tag) => ALLOWED_TAGS.has(tag.replace(/[<\/\s>]/g, '').toLowerCase()));
}

/* A style attribute the house will carry, or '' when it reaches out. */
export function scrubStyle(value) {
  const v = String(value || '').trim();
  if (!v) return '';
  if (REACHING.test(v)) return '';
  return v.slice(0, 2000);
}

function appendText(host, text) {
  /* newlines inside a styled box read as line breaks; paragraphs as gaps */
  const lines = String(text).split('\n');
  lines.forEach((line, i) => {
    if (i > 0) host.appendChild(document.createElement('br'));
    if (line) appendInline(host, line);
  });
}

function walk(src, host) {
  for (const node of Array.from(src.childNodes)) {
    if (node.nodeType === 3) { appendText(host, node.nodeValue); continue; }
    if (node.nodeType !== 1) continue;
    const tag = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) { appendText(host, node.textContent || ''); continue; }
    const el = document.createElement(tag);
    for (const attr of Array.from(node.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ALLOWED_ATTRS.has(name)) continue;
      if (name === 'style') { const st = scrubStyle(attr.value); if (st) el.setAttribute('style', st); continue; }
      if (name === 'open') { el.setAttribute('open', ''); continue; }
      el.setAttribute(name, String(attr.value).slice(0, 200));
    }
    if (tag !== 'br' && tag !== 'hr') walk(node, el);
    host.appendChild(el);
  }
}

export function renderHtmlProse(text) {
  const frag = document.createDocumentFragment();
  let doc;
  try {
    doc = new DOMParser().parseFromString('<!doctype html><body>' + String(text || '') + '</body>', 'text/html');
  } catch (err) {
    appendText(frag, String(text || ''));
    return frag;
  }
  walk(doc.body, frag);
  return frag;
}
