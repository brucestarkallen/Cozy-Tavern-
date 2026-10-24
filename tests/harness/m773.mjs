/* Cozy Tavern — harness laws of M773: the automatic brief knows which pages it was written after (his: "Does the automatic
 * brief always been checked in branch chat or something Bassically foolproof and everything is always adjusted and updated
 * smartly if something happens"). DOM-M773-1 runs it through the app; these run the keeper's own decision. */
import { test, assert, eq } from './lib.mjs';
import { groundPagesPrint, groundPagesChanged, runGround, GROUND_RULES } from '../../js/agents/worldground.js';

const page = (id, text, extra = {}) => ({ id, role: id.startsWith('u') ? 'user' : 'assistant', text, ...extra });
const PAGES = [page('u0', 'I wait.'), page('a0', 'The envoys talked of the treaty.'), page('u1', 'I listen.'), page('a1', 'The treaty was signed.')];
const stamped = { parts: { standing: 'The treaty stands.' }, recordLines: 0, rules: GROUND_RULES, by: 'helper', pagesSeen: PAGES.length, pagesPrint: groundPagesPrint(PAGES) };

test('M773-1 A PAGE THE WORLD WAS WRITTEN AFTER, CHANGED IN ANY WAY, IS SEEN; A PAGE ADDED AFTER IT IS NOT A CHANGE', () => {
  eq(groundPagesChanged(stamped, PAGES), false, 'the same pages');
  eq(groundPagesChanged(stamped, [...PAGES, page('u2', 'I go.'), page('a2', 'They left.')]), false, 'pages added after it');
  eq(groundPagesChanged(stamped, PAGES.slice(0, 3)), true, 'its last page taken back');
  eq(groundPagesChanged(stamped, PAGES.map((p) => (p.id === 'a1' ? { ...p, text: 'The treaty was torn up.' } : p))), true, 'a page edited');
  eq(groundPagesChanged(stamped, PAGES.map((p) => (p.id === 'a1' ? { ...p, swipes: ['The treaty was signed.', 'The envoys walked out.'], swipeIndex: 1, text: 'The envoys walked out.' } : p))), true, 'a page told again (another version shown)');
  eq(groundPagesChanged({ ...stamped, pagesSeen: undefined, pagesPrint: undefined }, PAGES.slice(0, 1)), false, 'a world written before M773 keeps its old rule');
});

test('M773-2 A CHANGED PAGE ASKS FOR THE WORLD WHOLE, FROM THE STORY AS IT STANDS — NEVER AN UPDATE OF THE OLD ONE; HIS OWN WORLD STANDS', async () => {
  let asked = '';
  const connection = { type: 'openai', baseUrl: 'https://fixture.example/v1', apiKey: 'k', model: 'm', contextSize: 200000 };
  const was = globalThis.fetch;
  globalThis.fetch = async (_, o) => {
    const user = JSON.parse(o.body).messages.filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    asked = /Write the world of this story/.test(user) ? 'whole' : 'update';
    return new Response('data: ' + JSON.stringify({ choices: [{ delta: { content: JSON.stringify({ world: 'A city of envoys.', standing: 'No treaty stands.' }) } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n');
  };
  try {
    const out = await runGround({ connection, have: stamped, input: { pagesChanged: true, pagesSeen: 3, pagesPrint: groundPagesPrint(PAGES.slice(0, 3)) }, recordLines: 0 });
    eq(asked, 'whole', 'written whole');
    eq(out.ground.parts.standing, 'No treaty stands.', 'from the story as it stands');
    eq(out.ground.pagesSeen, 3, 'and stamped with the pages it was written after');
    asked = '';
    const his = await runGround({ connection, have: { ...stamped, by: 'writer' }, input: { pagesChanged: true }, recordLines: 0 });
    eq(his.wrote, false, 'his own world stands'); eq(asked, '', 'nothing asked');
  } finally { globalThis.fetch = was; }
});
