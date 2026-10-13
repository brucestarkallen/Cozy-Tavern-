/* The standalone milestone fixtures M689–M745 (tests/harness/m689-focused.mjs … m745-source-repair.mjs) are plain node
 * scripts with node:assert: each seeds its own in-memory IndexedDB (idb-shim) and its own fetch mock, so each runs in a
 * process of its own. They were written beside their milestones but never imported here, so the suite never ran them and
 * twenty-two of them rotted unseen (the audit of M682–M751). Now every one runs on every full pass.
 * Left out: m730-browser.mjs is a browser module — it only exports run() for tests/m730_housekeeper.mjs (Playwright and
 * Chromium's real IndexedDB); run directly it defines run() and exits 0 having checked nothing. */
import { test } from './lib.mjs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const FOCUSED = [
  ['M689-F', 'm689-focused.mjs', 'the readers’ context, the auditor’s authority and the stalled-retry fingerprint'],
  ['M690-F', 'm690-focused.mjs', 'the copyable ledger diagnostics'],
  ['M691-F', 'm691-focused.mjs', 'the diagnostics bounded to 24 KB'],
  ['M692-F', 'm692-focused.mjs', 'open findings stay amber and a 1/2/1 repair churn pauses'],
  ['M693-F', 'm693-focused.mjs', 'an owner and her dependent never merge; the completed ending beats a stale earlier position'],
  ['M694-F', 'm694-focused.mjs', 'earlier evidence, World voices, inherited ids closed and a truly current green'],
  ['M695-F', 'm695-focused.mjs', 'World recovery at the same moment creates no new audit evidence'],
  ['M696-F', 'm696-focused.mjs', 'inherited findings repaired from their original evidence'],
  ['M697-F', 'm697-focused.mjs', 'auditor evidence bound to original references; a disputed merge withheld'],
  ['M698-F', 'm698-focused.mjs', 'actual ledger entries verified before green'],
  ['M699-F', 'm699-focused.mjs', 'the whole large ledger reviewed together; People recovered from original sources'],
  ['M700-F', 'm700-focused.mjs', 'late descriptions recovered, operationless findings closed only by verified records, the player persona kept'],
  ['M701-F', 'm701-focused.mjs', 'long original passages through the whole audit; duplicate writes saved once'],
  ['M702-F', 'm702-focused.mjs', 'identity decisions and entry receipts: caller-bound snapshots, wrong hashes refused'],
  ['M703-F', 'm703-focused.mjs', 'writer facts, provider flags, an unapproved shortening withheld, only the unfinished check resumed'],
  ['M704-F', 'm704-focused.mjs', 'recovered appearance before a character is approved'],
  ['M705-F', 'm705-focused.mjs', 'profile references, approved facts and an unnamed role recovered'],
  ['M706-F', 'm706-focused.mjs', 'an unmatched writer fact settled in the one review without a cosmetic rewrite'],
  ['M707-F', 'm707-focused.mjs', 'one continuation of the same review; durable checkpoints and the shared evidence book'],
  ['M708-F', 'm708-focused.mjs', 'one combined verdict; contradictory faces never saved'],
  ['M709-F', 'm709-focused.mjs', 'the final auditor’s verdict and its concise approval'],
  ['M710-F', 'm710-ending.mjs', 'the completed scene saved and reconciled'],
  ['M711-F', 'm711-ending.mjs', 'physical history kept apart from the ending snapshot'],
  ['M713-F', 'm713-workers.mjs', 'the workers capture the ledger upstream; durable records before the audit'],
  ['M714-F', 'm714-foundation.mjs', 'the storyteller’s context selection and the source recovery'],
  ['M715-F', 'm715-source-resume.mjs', 'source receipts repaired; completed audits reused'],
  ['M716-F', 'm716-entity-subject.mjs', 'entity ownership repaired upstream; source corrections kept'],
  ['M717-F', 'm717-source-passages.mjs', 'source evidence bound to ordered original passages'],
  ['M718-F', 'm718-source-identity.mjs', 'source-local identity decisions persisted in the final transaction'],
  ['M719-F1', 'm719-followups.mjs', 'People completion status and contextual source identities'],
  ['M719-F2', 'm719-ledger.mjs', 'identity by evidence, kept apart from the World simulation'],
  ['M722-F', 'm722-focused.mjs', 'source bindings settled; historical corrections recovered (M722–M724)'],
  ['M731-F1', 'm731-identity.mjs', 'executable source identities and evidence-based worker status'],
  ['M731-F2', 'm731-world.mjs', 'World voice identities'],
  ['M732-F', 'm732-identity-contract.mjs', 'one executable source identity contract'],
  ['M737-F', 'm737-context.mjs', 'context meaning kept by source-based selection and honest transport accounting'],
  ['M738-F', 'm738-knowledge.mjs', 'knowledge perspectives kept distinct'],
  ['M743-F', 'm743-auditor.mjs', 'source fact repairs completed'],
  ['M745-F', 'm745-source-repair.mjs', 'stale record sources repaired'],
];

for (const [id, file, what] of FOCUSED) {
  test(`${id} ${what} (tests/harness/${file}, in its own process)`, () => {
    const run = spawnSync(process.execPath, [path.join(root, 'tests', 'harness', file)],
      { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    /* its last progress lines, then the error itself (node prints the failing line and code above the message) */
    const said = String(run.stdout || '').trim().split('\n').slice(-4);
    const err = String(run.stderr || '').trim().split('\n');
    const from = Math.max(0, err.findIndex((line) => /Error\b/.test(line)) - 3);
    const tail = [...said, ...err.slice(from, from + 14)].join('\n');
    if (run.error) throw new Error(`${file} did not finish: ${run.error.message}\n${tail}`);
    if (run.status !== 0) throw new Error(`${file} exited ${run.status === null ? 'on ' + run.signal : run.status}\n${tail}`);
  });
}
