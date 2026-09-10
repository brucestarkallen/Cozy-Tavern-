/* Cozy Tavern — ui/storyexport.js
 * M22-E4: the per-story export, built pure so the harness can hold it to
 * account — the tale as markdown (a readable script, one section a page)
 * and as jsonl (the raw pages, one JSON line each, shown swipe only).
 * Hidden pages (the continue nudge) never travel.
 */
import { pageText } from '../assemble/stack.js';

function visiblePages(pages) {
  return (Array.isArray(pages) ? pages : []).filter((m) => m && !m.hidden);
}

function fmtWhen(ts) {
  if (!ts) return 'undated';
  const d = new Date(ts);
  return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

export function storyToMarkdown(story, pages) {
  const out = [`# ${(story && story.title) || 'Untitled tale'}`, ''];
  for (const m of visiblePages(pages)) {
    const speaker = m.role === 'assistant' ? 'the storyteller' : 'you';
    out.push(`## ${speaker} — ${fmtWhen(m.ts)}`, '', pageText(m), '');
  }
  return out.join('\n');
}

export function storyToJsonl(story, pages) {
  const lines = visiblePages(pages).map((m) => JSON.stringify({
    role: m.role,
    text: pageText(m),
    ts: m.ts,
    thinking: m.thinking || undefined,
    ooc: m.ooc || undefined,
  }));
  return lines.length ? lines.join('\n') + '\n' : '';
}

export function storyExportBasename(story) {
  return String((story && story.title) || 'untitled')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .slice(0, 60) || 'tale';
}
