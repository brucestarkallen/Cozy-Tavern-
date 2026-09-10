/* Cozy Tavern — ui/prose.js
 * M22-E5/E6: code blocks and markdown-lite for the story's prose.
 *
 * splitBlocks(text) lifts fenced code blocks (```lang … ```) out of the
 * flow — pure, so the harness can hold it to account. inlineMd(text) is
 * the RP-safe inline subset: `code`, **strong**, *emphasis* — and the
 * asterisk action-convention stays intact, because a single-asterisk span
 * IS the emphasis carve-out (it renders italic, the way roleplay reads it).
 * No links, no images, no raw HTML — ever. Everything is built as DOM
 * nodes from text; nothing here ever touches innerHTML.
 *
 * renderRich(text) composes the two into a DocumentFragment ready to
 * append into a message body: code blocks render mono on --code-bg with a
 * copy chip; prose paragraphs carry the inline marks.
 */

/* Split text into prose and fenced-code parts. An unclosed fence runs to
 * the end of the text (the storyteller may still be writing). */
export function splitBlocks(text) {
  const lines = String(text == null ? '' : text).split('\n');
  const parts = [];
  let prose = [];
  let code = null; // {lang, lines[]}
  const flushProse = () => {
    if (!prose.length) return;
    parts.push({ type: 'prose', text: prose.join('\n') });
    prose = [];
  };
  const flushCode = () => {
    if (!code) return;
    parts.push({ type: 'code', lang: code.lang, text: code.lines.join('\n') });
    code = null;
  };
  for (const line of lines) {
    const fence = line.match(/^```(\S*)\s*$/);
    if (code) {
      if (fence) flushCode();
      else code.lines.push(line);
      continue;
    }
    if (fence) {
      flushProse();
      code = { lang: fence[1] || '', lines: [] };
      continue;
    }
    prose.push(line);
  }
  flushProse();
  flushCode();
  return parts;
}

/* The inline subset, as a flat token list: [{k:'text'|'code'|'strong'|'em',
 * text}]. Order of carving: `code` first (its insides are literal), then
 * **strong**, then *emphasis*. A marker with nothing inside, or one never
 * closed, is plain text — the storyteller's asterisks are safe. */
export function inlineMd(text) {
  const out = [];
  const carve = (str, k) => { if (str) out.push({ k, text: str }); };
  /* `code` */
  const codeRe = /`([^`\n]+)`/g;
  let m;
  const codeSpans = [];
  let last = 0;
  while ((m = codeRe.exec(text)) !== null) {
    if (m.index > last) codeSpans.push({ k: 'text', text: text.slice(last, m.index) });
    codeSpans.push({ k: 'code', text: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) codeSpans.push({ k: 'text', text: text.slice(last) });
  if (!codeSpans.length) codeSpans.push({ k: 'text', text });

  /* **strong** inside the remaining text spans */
  const strongRe = /\*\*([^*\n]+)\*\*/g;
  const strongSpans = [];
  for (const span of codeSpans) {
    if (span.k !== 'text') { strongSpans.push(span); continue; }
    last = 0;
    let matched = false;
    while ((m = strongRe.exec(span.text)) !== null) {
      matched = true;
      if (m.index > last) strongSpans.push({ k: 'text', text: span.text.slice(last, m.index) });
      strongSpans.push({ k: 'strong', text: m[1] });
      last = m.index + m[0].length;
    }
    if (last < span.text.length) strongSpans.push({ k: 'text', text: span.text.slice(last) });
    if (!matched && span.text.length === 0) { /* nothing to carry */ }
  }

  /* *emphasis* inside what is still plain text */
  /* A lone `*` never borrows a neighbor's asterisk (so "**unclosed" stays
   * plain text rather than pairing its first mark with an earlier one). */
  const emRe = /(?<!\*)\*([^*\n]+)\*(?!\*)/g;
  for (const span of strongSpans) {
    if (span.k !== 'text') { out.push(span); continue; }
    last = 0;
    while ((m = emRe.exec(span.text)) !== null) {
      if (m.index > last) carve(span.text.slice(last, m.index), 'text');
      carve(m[1], 'em');
      last = m.index + m[0].length;
    }
    if (last < span.text.length) carve(span.text.slice(last), 'text');
  }
  return out;
}

/* ---------- DOM rendering (browser only; the harness holds the pures) ---------- */

const INLINE_TAGS = { strong: 'strong', em: 'em', code: 'code' };

/* One prose paragraph's worth of inline marks, appended into `host`. */
export function appendInline(host, text) {
  for (const tok of inlineMd(text)) {
    if (tok.k === 'text') {
      host.appendChild(document.createTextNode(tok.text));
    } else {
      const el = document.createElement(INLINE_TAGS[tok.k]);
      el.textContent = tok.text;
      host.appendChild(el);
    }
  }
}

/* A fenced block: mono on --code-bg, with the language whispered and a
 * copy chip. The chip's click is delegated by the thread (chat.js). */
export function codeBlockNode(lang, code) {
  const wrap = document.createElement('div');
  wrap.className = 'codeblock';
  const bar = document.createElement('div');
  bar.className = 'codeblock-bar';
  const langEl = document.createElement('span');
  langEl.className = 'codeblock-lang';
  langEl.textContent = lang || 'text';
  const copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'codeblock-copy';
  copy.textContent = 'copy';
  copy.setAttribute('aria-label', 'Copy this block');
  bar.append(langEl, copy);
  const pre = document.createElement('pre');
  const codeEl = document.createElement('code');
  codeEl.textContent = code.replace(/\n$/, '');
  pre.appendChild(codeEl);
  wrap.append(bar, pre);
  return wrap;
}

/* The whole rich flow: paragraphs and code blocks. Paragraphs split on
 * blank lines; single newlines stay as line breaks inside a paragraph. */
export function renderRich(text) {
  const frag = document.createDocumentFragment();
  for (const part of splitBlocks(text)) {
    if (part.type === 'code') {
      frag.appendChild(codeBlockNode(part.lang, part.text));
      continue;
    }
    const paras = part.text.split(/\n{2,}/);
    for (const para of paras) {
      if (!para.trim()) continue;
      const p = document.createElement('div');
      p.className = 'msg-prose';
      const lines = para.split('\n');
      lines.forEach((line, i) => {
        if (i) p.appendChild(document.createElement('br'));
        appendInline(p, line);
      });
      frag.appendChild(p);
    }
  }
  return frag;
}
