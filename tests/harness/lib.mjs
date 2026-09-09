/* The smallest honest harness: test(), assert(), eq(), and a runner. */
export const registry = [];
export function test(name, fn) { registry.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function eq(got, want, msg) {
  if (got !== want) throw new Error(`${msg || 'eq'} — got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
}
export async function runAll() {
  let pass = 0; const failed = [];
  for (const { name, fn } of registry) {
    try { await fn(); pass += 1; console.log('  ok —', name); }
    catch (err) { failed.push(name); console.log('  FAIL —', name, '\n     ', err && err.message); }
  }
  console.log(`\n${pass} passed, ${failed.length} failed, ${registry.length} total`);
  if (failed.length) process.exitCode = 1;
}
