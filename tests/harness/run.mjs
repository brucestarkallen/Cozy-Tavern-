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
import './m588.mjs'; /* M588: who is here, and where everyone else is */
import './m591.mjs'; /* M591: the header gate never loses the last line */
import './m604.mjs';
import './m607.mjs';
import './m608.mjs';
import './m609.mjs';
import './m612.mjs';
import './m615.mjs';
import './m616.mjs';
import './m619.mjs';
import './m620.mjs';
import './m622.mjs';
import './m623.mjs';
import './m625.mjs';
import './m626.mjs';
import './m627.mjs';
import './m628.mjs';
import './m630.mjs';
import './m632.mjs';
import './m633.mjs'; /* M604: things the story keeps; competence kept */
import './m673.mjs'; /* M673: the continuous audit */
import './m674.mjs'; /* M674: a text is folded once; a reading cut short shows its own pages' ledger */
import './m675.mjs'; /* M675: the judge's moment; the audit of the session before */
import './m675b.mjs'; /* M675, the second reading: the continuous audit's failures; the record's cut */
import './m677.mjs'; /* M677: where each of them is, asked by name; one rule for who knows what; the window marker is not bold */
import './m679.mjs'; /* M679: the story's own weekday; the spot in a city; each person with him or left behind; a verdict for every thread and loose end; the things its people carry; the auditor and the house's heal held to how the page ENDS; what answers a loose end */
import './m680.mjs'; /* M680: the whole ledger, room by room — the spot with its city, the world agent and the auditor held to the page's reader, the dead at every door, a sighting is not company, two writers never erase each other, a now's age and ground, "already so" is no refusal, a take-back outlives try again, the record's one rule when pages go, what is true of them told to every reader, a worker's writes stamped with their page */
import './m681.mjs'; /* M681: the clock — the days between two headers, the story's own weekday, a #time skip with a bare hour, his hand on the clock; and every open finding of M680's audit */
import { runAll } from './lib.mjs';
import './m682.mjs';
import './m750.mjs'; /* M750: our story so far, the record itself — each line once; the Essentials retired */
import './m752-record.mjs'; /* M752: the record keeper, the continuous audit's corrections and the lamp, after the review of M682–M751 */
import './m752-audit.mjs'; /* M752: the auditor's completion, storage and upkeep (the review of every update since M681) */
import './m752-spelling.mjs'; /* M752: the Housekeeper's spelling correction, held to the name — never a word, said once, taken back from its own receipt */
import './m752-knowledge.mjs'; /* M752: who knows what, one record a fact — a worker's label is no receipt; a learned truth answers its belief; "everyone here" on a page that opened empty; the readers told each kind of knowing; durable threads shown to a size */
import './m752-people.mjs'; /* M752: identity, persona, aliases and the people's core */
import './focused.mjs'; /* M689–M745: the standalone milestone fixtures, each run in its own process */
import './m752-request.mjs'; /* M752: the storyteller's request — its size, its fit, its receipts */
import './m752-continuous.mjs'; /* M752 (followup 4): the continuous audit's historical corrections settled, not stranded; quotes and pages read as written */
import './m752-store.mjs'; /* M752 (followup 8): a setting read while its own write is under way is the value being written */
import './m752-historical.mjs'; /* M752 (followup 9): a historical correction's conversation ends on a verdict — quotes across markup and with words left out read, mistakes said back, looks served */
import './m752-choices.mjs'; /* M752 (followup 13): Choices matter is handed the whole of what the storyteller saw */
import './m752-setaside.mjs'; /* M752 (followup 21): a source mention the auditor cannot tie to anyone is set aside, not owed forever */
import './m752-carry.mjs'; /* M752 (followup 22): an unchanged entry the new page does not name keeps its approval */
import './m752-branch.mjs'; /* M752 (followup 15): a branch keeps what the auditor paid for */
import './m753.mjs'; /* M753: speech marks paired as the screen pairs them; the readers' requests begin the same way page to page; readers that need nothing of each other read together */
import './m754.mjs'; /* M754: a loose end closed already is already so, and an old close the ledger already holds is settled — the auditor's light is never yellow for it */
import './m755.mjs'; /* M755: the page ends on him going out with her — the one who stayed is left behind, named on the page or not */
import './m756.mjs'; /* M756: a source fact is reconciled when its words are in the profile, not when its sentence is copied */
import './m758.mjs'; /* M758: the audit of m755-001…m757-001 — the goings that are not his, the quiet raven, a fact never waved through, the review's own answer, the entries left over read and approved */
import './m759.mjs'; /* M759: the world agent's voices — who is speaking is in the shape it is given, and his line says what waits on the auditor */
import './m760.mjs'; /* M760: the auditor's review fits its connection with every owed source fact — compact tasks, fitted to a room of their own */
import './m761.mjs'; /* M761: a value that lost its closing quote is read; an answer that could not be used is not "went well" */
import './m762.mjs'; /* M762: the continuous audit's reading may look before it alleges, as the housekeeper does */
import './m763.mjs'; /* M763: a forget that loses nothing (a name the ledger never held, an empty page) is the final review's to make */
import './m764.mjs'; /* M764: someone the page only talks about is asked where they are */
import './m769.mjs'; /* M769: the final audit — the scene, the people, the world and the book */
import './m770.mjs'; /* M770: the housekeeper retires its own replaced cards; an ending is where the page leaves someone */
import './m771.mjs'; /* M771: his persona and his own titled name, as before M769 */

console.log('Cozy Tavern — harness');
await import('./m683.mjs');
await import('./m684.mjs');
await import('./m685.mjs');
await import('./m687.mjs');
await import('./m688.mjs');

await runAll();
/* M386: it ends when its tests end, like the walk — a timer some module left (a debounce, a worker's ceiling) kept the
 * process alive after the summary, and every run left an idle node behind */
process.exit(process.exitCode || 0);
