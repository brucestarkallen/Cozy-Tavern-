#!/bin/bash
# M274: the lint audit — real bugs only (undefined names, duplicate keys, unreachable code,
# assignments to constants …), with the unused / shadowed / used-before-defined names as
# warnings to read by hand. ESLint 9 lints only under its config's folder, so the config is
# written into the repo for the run and removed after.
set -e
REPO="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p /tmp/lint && cd /tmp/lint
[ -x node_modules/.bin/eslint ] || { npm init -y > /dev/null; npm install --silent eslint@9 globals@15 > /dev/null; }
node --input-type=module -e "
import globals from 'globals';
import fs from 'fs';
const G = { ...globals.browser, ...globals.serviceworker };
const rules = {
  'no-undef': 'error', 'no-dupe-keys': 'error', 'no-dupe-args': 'error', 'no-dupe-class-members': 'error',
  'no-dupe-else-if': 'error', 'no-duplicate-case': 'error', 'no-unreachable': 'error', 'no-const-assign': 'error',
  'no-import-assign': 'error', 'no-func-assign': 'error', 'no-class-assign': 'error', 'no-self-assign': 'error',
  'no-self-compare': 'error', 'no-unsafe-finally': 'error', 'no-unsafe-negation': 'error', 'no-unsafe-optional-chaining': 'error',
  'use-isnan': 'error', 'valid-typeof': 'error', 'getter-return': 'error', 'no-setter-return': 'error',
  'no-cond-assign': ['error', 'except-parens'], 'no-loss-of-precision': 'error', 'no-sparse-arrays': 'error',
  'no-invalid-regexp': 'error', 'no-misleading-character-class': 'error', 'no-redeclare': 'error',
  'no-obj-calls': 'error', 'for-direction': 'error', 'no-compare-neg-zero': 'error', 'no-ex-assign': 'error',
  'no-useless-backreference': 'error', 'no-async-promise-executor': 'error', 'no-constant-binary-expression': 'error',
  'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-shadow': ['warn', { builtinGlobals: false, hoist: 'functions' }],
  'no-use-before-define': ['warn', { functions: false, classes: false, variables: true }],
};
fs.writeFileSync('$REPO/.audit.eslint.config.mjs', 'export default [{ files: [\"**/*.js\"], languageOptions: { ecmaVersion: 2023, sourceType: \"module\", globals: ' + JSON.stringify(G) + ' }, rules: ' + JSON.stringify(rules) + ' }];');
"
cd "$REPO"
trap 'rm -f "$REPO/.audit.eslint.config.mjs"' EXIT
/tmp/lint/node_modules/.bin/eslint --config .audit.eslint.config.mjs --no-config-lookup js sw.js "$@"
