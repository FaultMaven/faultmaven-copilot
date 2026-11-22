// @vitest-environment node
/**
 * An error's `name` is its identity: the API client, the poll, the classifier,
 * the retry util and the error handler all check it (faultmaven#2341). A
 * minifying build renames classes, so a name derived from the class
 * (`this.constructor.name`) shipped as `'xv'` and every one of those checks
 * missed. Each class names itself by literal, and these pin that the name
 * survives a rename: simulated over every export, and through a real minifier.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { transformWithEsbuild } from 'vite';
import * as types from '@faultmaven/copilot-ui/lib/errors/types';
import { UserFacingError, NetworkError } from '@faultmaven/copilot-ui/lib/errors/types';
import { ErrorClassifier } from '@faultmaven/copilot-ui/lib/errors/classifier';
import { isRetryableError } from '@faultmaven/copilot-ui/lib/utils/retry';
import { SessionEndedError } from '../../../extension/auth/session-ended-error';

type ErrorClass = new (...args: never[]) => Error;

/** Arguments only where the defaults throw. */
const ARGS: Record<string, unknown[]> = {
  DuplicateUploadNotice: [[{ filename: 'app.log', origin: 'file_upload' }]],
};

/** Every exported class of a module that extends its `UserFacingError`, by export key. */
function errorClasses(module: Record<string, unknown>): [string, ErrorClass][] {
  const base = module.UserFacingError as ErrorClass;
  return Object.entries(module).filter(
    (entry): entry is [string, ErrorClass] =>
      typeof entry[1] === 'function' && (entry[1] as ErrorClass).prototype instanceof base,
  );
}

function construct(key: string, Class: ErrorClass): Error {
  try {
    return new Class(...((ARGS[key] ?? []) as never[]));
  } catch (cause) {
    throw new Error(`cannot construct ${key}: give it arguments in ARGS`, { cause });
  }
}

/** Names the class `'x'`, as a minifier would, for the length of `body`. */
function renamed<T>(Class: ErrorClass, body: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Class, 'name')!;
  Object.defineProperty(Class, 'name', { value: 'x', configurable: true });
  try {
    return body();
  } finally {
    Object.defineProperty(Class, 'name', original);
  }
}

describe('error identity survives a renamed class (faultmaven#2341)', () => {
  const classes = errorClasses(types);

  it('finds the exported classes', () => {
    expect(classes.length).toBeGreaterThanOrEqual(26);
  });

  it.each(classes)('%s keeps its name when its class is renamed', (key, Class) => {
    const error = renamed(Class, () => construct(key, Class));
    expect(error.name).toBe(key);
  });

  it("SessionEndedError, the extension's own subclass, keeps its name", () => {
    const error = renamed(SessionEndedError, () => new SessionEndedError('revoked', 'token-a'));
    expect(error.name).toBe('SessionEndedError');
    expect(error).toBeInstanceOf(UserFacingError);
  });

  // The shipped symptom: a NetworkError was not retryable by name, and once it
  // crossed a context boundary (only `name` and `message` survive) the
  // classifier no longer knew it as a network failure.
  it('a renamed NetworkError is still retryable and still classified as network', () => {
    const error = renamed(NetworkError, () => new NetworkError('boom'));
    expect(isRetryableError(error)).toBe(true);

    const crossed = Object.assign(new Error(error.message), { name: error.name });
    const classified = ErrorClassifier.classify(crossed);
    expect(classified.category).toBe('network');
    expect(classified.recovery).toBe('retry_with_backoff');
  });
});

describe('error identity survives a real minifier (faultmaven#2341)', () => {
  it('every class in types.ts, minified with esbuild, keeps its name', async () => {
    const file = new URL('../../../../packages/copilot-ui/lib/errors/types.ts', import.meta.url);
    const { code } = await transformWithEsbuild(readFileSync(file, 'utf8'), file.pathname, {
      loader: 'ts',
      format: 'cjs',
      target: 'es2022',
      minifyIdentifiers: true,
    });
    const module: { exports: Record<string, unknown> } = { exports: {} };
    new Function('module', 'exports', code)(module, module.exports);

    const classes = errorClasses(module.exports);
    expect(classes.map(([key]) => key).sort()).toEqual(errorClasses(types).map(([key]) => key).sort());
    // The minifier did rename them, or this proves nothing.
    expect((module.exports.NetworkError as ErrorClass).name).not.toBe('NetworkError');
    for (const [key, Class] of classes) {
      expect(construct(key, Class).name, key).toBe(key);
    }
  });
});
