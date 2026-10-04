/* Cozy Tavern — the in-repo harness (M9, A8).
 * Run it: node tests/harness/run.mjs */
import './stack.mjs';
import './store.mjs';
import './fold-fuzz.mjs';
import './fold-fuzz-names.mjs';
import './m100.mjs';
import './engine.mjs';
import './agents.mjs';
import './referee.mjs';
import './providers.mjs';
import './tablock.mjs';
import './source.mjs';
import './housekeeper.mjs';
import './showrunners.mjs';
import './finishing.mjs';
import './beauty.mjs';
import './assign.mjs';
import './m22.mjs';
import './books.mjs';
import './polish.mjs';
import './projects.mjs';
import './findability.mjs';
import './m21.mjs';
import './m28.mjs';
import './m29.mjs';
import './m30.mjs';
import './m31.mjs';
import './m32.mjs';
import './m33.mjs';
import './m34.mjs';
import './m35.mjs';
import './m36.mjs';
import './m37.mjs';
import './m38.mjs';
import './m40.mjs';
import './m41.mjs';
import './m43.mjs';
import './m44.mjs';
import './m45.mjs';
import './m46.mjs';
import './m47.mjs';
import './m48.mjs';
import './m49.mjs';
import './m50.mjs';
import './m52.mjs';
import './m53.mjs';
import './m57.mjs';
import './m61.mjs';
import './m62.mjs';
import './m72.mjs';
import './m73.mjs';
import './m74.mjs';
import './m75.mjs';
import './m76.mjs';
import './m78.mjs';
import './m79.mjs';
import './m82.mjs';
import './m83.mjs';
import './m85.mjs';
import './m259.mjs';
import './m345.mjs';
import './m346.mjs';
import './m347.mjs';
import './m348.mjs';
import './m349.mjs';
import './m350.mjs';
import './m351.mjs';
import './m352.mjs';
import './m353.mjs';
import './m354.mjs';
import './m356.mjs';
import './m357.mjs';
import './m359.mjs';
import './m364.mjs';
import './m372.mjs';
import './m373.mjs';
import './m376.mjs';
import './m379.mjs';
import './m382.mjs';
import './m293.mjs';
import './m294.mjs';
import './m297.mjs';
import './m298.mjs';
import './m300.mjs';
import './m301.mjs';
import './m302.mjs';
import './m303.mjs';
import './m304.mjs';
import './m305.mjs';
import './m306.mjs';
import './m307.mjs';
import './m308.mjs';
import './m309.mjs';
import './m311.mjs';
import './m312.mjs';
import './m314.mjs';
import './m315.mjs';
import './m316.mjs';
import './m317.mjs';
import './m318.mjs';
import './m320.mjs';
import './m322.mjs';
import './m327.mjs';
import './m328.mjs';
import './m330.mjs';
import './m334.mjs';
import './m335.mjs';
import './m336.mjs';
import './m337.mjs';
import './m338.mjs';
import './m339.mjs';
import './m340.mjs';
import './m343.mjs';
import './m386.mjs';
import './m388.mjs';
import './m389.mjs';
import './m390.mjs';
import './m392.mjs';
import './m396.mjs';
import './m397.mjs';
import './m398.mjs';
import './m399.mjs';
import './m400.mjs';
import './m401.mjs';
import './m402.mjs';
import './m403.mjs';
import './m405.mjs';
import './m414.mjs';
import './m415.mjs';
import './m416.mjs';
import './m417.mjs';
import './m418.mjs';
import './m419.mjs';
import './m420.mjs';
import './m421.mjs';
import './m422.mjs';
import './m425.mjs';
import './m427.mjs';
import './m432.mjs';
import './m433.mjs';
import './m434.mjs';
import './m435.mjs';
import './m436.mjs';
import './m437.mjs';
import './m438.mjs';
import './m439.mjs';
import './m440.mjs';
import './m441.mjs';
import './m444.mjs';
import './m445.mjs';
import './m446.mjs';
import './m447.mjs';
import './m448.mjs';
import './m449.mjs';
import './m450.mjs';
import './m451.mjs';
import './m452.mjs';
import './m453.mjs';
import './m455.mjs';
import './m456.mjs';
import './m457.mjs';
import './m457b.mjs';
import './m458.mjs';
import './m459.mjs';
import './m460.mjs';
import './m461.mjs';
import './m462.mjs';
import './record-fuzz.mjs';
import './m466.mjs';
import './m467.mjs';
import './m469.mjs';
import './m470.mjs';
import './m471.mjs';
import './m472.mjs';
import './m476.mjs';
import './m478.mjs';
import './m482.mjs';
import './m484.mjs';
import './m490.mjs';
import './m491.mjs';
import './livingledger.mjs';
import './m495.mjs';
import './m505.mjs';
import './m507.mjs';
import './m508.mjs';
import './m510.mjs'; /* M510: the small-model mode */
import './m511.mjs'; /* M511: after the crash — a branch keeps its pages whole; what the storyteller saw is what was sent */
import './m512.mjs'; /* M512: the small model at its best — his prose laws, the story's voice, no worn phrases, each person's voice */
import './m514.mjs'; /* M514: a person with no page gets one — the people of a #story opening fill in by themselves */
import './m515.mjs'; /* M515: how people really take it — his laws on reactions on every small page; each person under pressure */
import './m516.mjs'; /* M516: where our story began in its canon — asked once on a #story, carried every page */
import './m517.mjs'; /* M517: the automatic brief — the world, written once, rewritten only where it moved */
import './m518.mjs'; /* M518: canon on their own page — the note goes quiet on what the cards carry */
import './m519.mjs'; /* M519: when the sound drowns the story — the brake, the breath, the mirror eased */
import './m520.mjs'; /* M520: who knows what, unscrambled — no moment in its own subject's book, no hidden act in the room's */
import './m522.mjs'; /* M522: the auditor can set a shared line right — the longer wording stays, letting go takes the line meant */
import './m524.mjs'; /* M524: a block of tags after the page — off at the door, the wire and the mend; standings stay the ledger's */
import './m527.mjs'; /* M527: the deep audit, second pass — what pages taken back leave behind */
import './m528.mjs'; /* M528: the deep audit, third pass — a page rewritten by hand */
import './m529.mjs'; /* M529: two workers at once — the side lane */
import './m535.mjs'; /* M535: the captains who left stay gone — the auditor's walk-ins held to the newest page, and put right */
import './m537.mjs'; /* M537: a misspelling of someone found is not "not found" */
import './m540.mjs'; /* M540: short names are the same day */
import './m541.mjs'; /* M541: last seen is when they were last in the scene */
import './m542.mjs'; /* M542: a tracked person is named once */
import './m543.mjs'; /* M543: no window on someone in the scene */
import './m544.mjs'; /* M544: voices beyond the room; a note from before they came in */
import './m546.mjs'; /* M546: the header gate reads short names */
import './m546.mjs'; /* M546: the header gate reads short names */
import './m547.mjs'; /* M547: the smart recall for a small storyteller too */
import './m548.mjs'; /* M548: Choices matter */
import './m549.mjs'; /* M549: the automatic brief's seats from the wiki; the choices keeper's own model */
import './m550.mjs'; /* M550: where our story began, checked against the wiki */
import './m551.mjs'; /* M551: one check for what a helper wrote from memory */
import './m552.mjs'; /* M552: the audit — the house's examples, the world keeper's memory of what was wrong */
import './m553.mjs'; /* M553: the audit, part 2 — what is read back from storage passes through its shape */
import './m554.mjs'; /* M554: the sheet by evidence; who is in the scene, one definition */
import './m555.mjs'; /* M555: Weigh them again weighs fresh; the sharp game master; his hand means his hand */
import './m556.mjs'; /* M556: a weighing he asks for is blind to the old numbers */
import './m558.mjs'; /* M558: the truth, never the mask; defaults below the best */
import './m559.mjs'; /* M559: a person's loose ends no longer forget */
import './m560.mjs'; /* M560: the weighing sees the whole story and says why */
import './m561.mjs'; /* M561: the whole brief, the whole story in brief, the record and every page that fits */
import './m562.mjs'; /* M562: one game master's procedure; the better fighter counted once; the ruling quick */
import './m563.mjs'; /* M563: every helper's request, as the model receives it */
import './m564.mjs'; /* M564: the founder is handed the real record */
import './m565.mjs'; /* M565: the essentials of a long tale, in parts */
import './m566.mjs'; /* M566: the brief held to the shared room in every helper */
import './m568.mjs'; /* M568: a world part of the wrong kind is left out */
import './m570.mjs'; /* M570: the ledger's pages shared between checkpoints */
import './m572.mjs'; /* M572: the scribe's and the second reader's instructions read whole */
import './m573.mjs'; /* M573: every wiki request has a time limit */
import './m574.mjs'; /* M574: the line-by-line audit, part 1 */
import './m575.mjs'; /* M575: one fingerprint */
import './m578.mjs'; /* M578: the line-by-line audit, part 5 */
import './m580.mjs'; /* M580: the structured prefill */
import './m584.mjs'; /* M584: the line-by-line audit, part 7 */
import { runAll } from './lib.mjs';

console.log('Cozy Tavern — harness');
await runAll();
/* M386: it ends when its tests end, like the walk — a timer some module left (a debounce, a worker's ceiling) kept the
 * process alive after the summary, and every run left an idle node behind */
process.exit(process.exitCode || 0);
