/* M427: one story's canon never speaks in another — the other names canon lends the matcher are heard only while the
 * story they belong to is the open one. Runs the real matcher and the real page finder. */
import { test, assert, eq } from './lib.mjs';
import { samePersonName, setAliasSource, setAliasScope } from '../../js/engine/names.js';
import { findPersonKey } from '../../js/engine/people.js';

test('M427-1 HIS BLEACH TALE\u2019S CANON NAMES ARE HEARD IN THAT TALE ONLY: "Soi Fon" is Suì-Fēng while the Bleach tale is open — in another tale they are two names', () => {
  let open = 'bleach';
  try {
    setAliasSource(() => [['Suì-Fēng', 'Soi Fon', 'Shaolin Fēng']], 'bleach');
    setAliasScope(() => open);
    eq(samePersonName('Soi Fon', 'Suì-Fēng'), true, 'in the Bleach tale, canon knows her other name');
    eq(findPersonKey({ 'Suì-Fēng': {} }, 'Soi Fon'), 'Suì-Fēng', 'and her page is found by it');
    open = 'ravenwood';
    eq(samePersonName('Soi Fon', 'Suì-Fēng'), false, 'in another tale, Bleach\u2019s canon says nothing');
    eq(findPersonKey({ 'Suì-Fēng': {} }, 'Soi Fon'), '', 'nor finds a page by it');
    open = null;
    eq(samePersonName('Soi Fon', 'Suì-Fēng'), true, 'with no tale known (no scope), heard as before');
  } finally {
    setAliasSource(null);
    setAliasScope(null);
  }
});
