// The suite's default jsdom environment, not `node`: the shared setup file
// (src/test/setup.ts) defines properties on `window`, so it cannot load under
// `node`. The generator runs in a child process either way.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The generator reads the contract notes as the spec's sibling. A query or a
 * fragment would be dropped from that sibling, so it could serve another ref's
 * notes beside this spec: the generator refuses such a URL before it fetches or
 * writes anything. That is what keeps this test offline; 127.0.0.1:1 makes an
 * accidental fetch fail fast and locally.
 */
// Vitest runs from the repository root, as case-service.test.ts relies on too.
const REPO_ROOT = process.cwd();
const SCRIPT = path.join(REPO_ROOT, 'scripts', 'generate-api-types.mjs');
const GENERATED = ['api.generated.ts', 'contract-notes.json', 'contract-vocabularies.json'].map((name) =>
  path.join(REPO_ROOT, 'packages', 'copilot-ui', 'types', name),
);
const snapshot = () => GENERATED.map((file) => ({ file, mtimeMs: statSync(file).mtimeMs, content: readFileSync(file, 'utf8') }));

const SPEC = 'http://127.0.0.1:1/x/openapi.json';
const CASES = [
  { name: 'a query on --spec', args: ['--spec', `${SPEC}?q`], env: {} },
  { name: 'a fragment on --spec', args: ['--spec', `${SPEC}#frag`], env: {} },
  { name: 'a query through FM_OPENAPI_SPEC', args: [], env: { FM_OPENAPI_SPEC: `${SPEC}?q` } },
];

describe('generate-api-types: a URL spec with a query or fragment', () => {
  it.each(CASES)('refuses $name, and writes nothing', ({ args, env }) => {
    const childEnv: NodeJS.ProcessEnv = { ...process.env, ...env };
    if (!('FM_OPENAPI_SPEC' in env)) delete childEnv.FM_OPENAPI_SPEC;
    const before = snapshot();

    const run = spawnSync(process.execPath, [SCRIPT, ...args], { cwd: REPO_ROOT, env: childEnv, encoding: 'utf8' });

    expect(run.status).toBe(1);
    expect(run.stderr).toContain('Cannot locate the contract notes beside a URL with a query or fragment');
    expect(snapshot()).toEqual(before);
  });
});
