/* M461: canon's words come through whole — the wiki's Japanese-term templates ({{Nihongo|Tenth Division|十番隊|Jūbantai}})
 * were deleted whole by the template stripper, and his canon note read "The  is one of the Gotei 13" and "a white , a
 * black , a black ,". Runs the extension's own cleaner. */
import './idb-shim.mjs';
import { test, assert, eq } from './lib.mjs';
import { cleanWikitext } from '../../js/canon/grounding.js';

test('M461-1 THE TERM IN A JAPANESE-TERM TEMPLATE SURVIVES — the English, or the romaji when the English is empty; {{lang}} keeps its text; any other template still goes', () => {
  eq(cleanWikitext('The {{Nihongo|Tenth Division|十番隊|Jūbantai}} is one of the Gotei 13, headed by Captain [[Tōshirō Hitsugaya]].'), 'The Tenth Division is one of the Gotei 13, headed by Captain Tōshirō Hitsugaya.');
  eq(cleanWikitext('It is composed of a white {{nihongo|shitagi|下着}}, a black {{nihongo|kosode|小袖}}, and {{nihongo|waraji|草鞋}}.'), 'It is composed of a white shitagi, a black kosode, and waraji.');
  eq(cleanWikitext('A {{nihongo||死覇装|Shihakushō}} is the standard uniform.'), 'A Shihakushō is the standard uniform.');
  eq(cleanWikitext('{{lang|ja|Kidō}} is magic.{{Infobox character|name=x}}'), 'Kidō is magic.');
  assert(!/\bThe\s+is\b|white\s*,/.test(cleanWikitext('The {{Nihongo|Fourth Division|四番隊|Yonbantai}}, is one of the Gotei 13.')), 'no hole where the term was');
});
