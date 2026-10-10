/* M684: source checks for newly introduced identities. Partial name matching is
 * useful for recall, but must never justify an invented surname or royal rank. */
import { foldName } from './names.js';

export function exactNameIn(text, name) {
  const n = foldName(name);
  return Boolean(n) && (' ' + foldName(text) + ' ').includes(' ' + n + ' ');
}

export function quotedSource(text, quote) {
  const tidy = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const q = tidy(quote);
  return q.length >= 4 && q.length <= 1200 && tidy(text).includes(q) ? q : '';
}

export const WRITER_FACTS = 'The writer’s explicit names, ranks, relations and biographies are story facts, even if the reply uses pronouns or omits them. Keep exact names and roles; invent no surname or rank. Read actions in both messages in order: a later departure still wins. Dialogue can establish an identity without placing its speaker’s subject nearby. Questions, wishes, hypotheticals and requests are not completed events. A person deliberately introduced by the writer gets a People page even if absent or quiet; an unnamed extra does not.';
