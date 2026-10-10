/* The smallest honest harness: test(), assert(), eq(), and a runner. */
export const registry = [];
export function test(name, fn) { registry.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function eq(got, want, msg) {
  if (got !== want) throw new Error(`${msg || 'eq'} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}
export async function runAll() {
  let pass = 0; const failed = []; const timings = [];
  const started = performance.now();
  /* ONLY='DOM-8c|DOM-1 ' runs the scenarios whose names match — for finding a fault; a gate runs them all */
  const only = typeof process !== 'undefined' && process.env && process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  for (const { name, fn } of registry) {
    if (only && !only.test(name)) continue;
    const begin = performance.now();
    let ok = true;
    try { await fn(); pass += 1; console.log('  ok —', name); }
    catch (err) { ok = false; failed.push(name); console.log('  FAIL —', name, '\n     ', err && err.message); }
    timings.push({ name, ok, milliseconds: Math.round(performance.now() - begin) });
  }
  console.log(`\n${pass} passed, ${failed.length} failed, ${registry.length} total`);
  if (!timings.length) { console.log('FAIL: the selector matched no tests.'); process.exitCode = 1; }
  if (failed.length) process.exitCode = 1;
  if (process.env.TEST_REPORT) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(process.env.TEST_REPORT, JSON.stringify({ passed: pass, failed: failed.length, selected: timings.length, total: registry.length, milliseconds: Math.round(performance.now() - started), tests: timings }, null, 2) + '\n');
  }
}

/* M510-37: the notes ride as the last system block (above the story, never cached) — no longer a user message first */
export const notesOf = (r) => { const b = ((r && r.systemBlocks) || []).slice(4).find((x) => x && typeof x.text === 'string' && /where things stand/i.test(x.text)); return b ? b.text : ''; }; /* M510-39: seat 4 is the woken rules; the notes follow */
