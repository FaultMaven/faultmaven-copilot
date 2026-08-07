#!/usr/bin/env node
/**
 * Regenerate src/types/api.generated.ts from the API's OpenAPI spec.
 *
 * Defaults to faultmaven's committed spec on `main` — the same source CI
 * compares against — rather than a sibling working tree. A sibling checkout is
 * whatever branch someone left it on, so defaulting to it meant the documented
 * command could silently produce a client for an API that does not exist.
 *
 * Choose a different spec with either form; both work identically on every
 * platform:
 *
 *   pnpm generate:api-types --spec ../faultmaven/docs/reference/api/openapi.json
 *   FM_OPENAPI_SPEC=... pnpm generate:api-types      # POSIX shells, and CI
 *
 * The generator is invoked as `node <cli.js> …` rather than through a shell.
 * Spawning the `.cmd` shim with `shell: true` on Windows joins the arguments
 * into a command line without quoting, so a spec path containing a space —
 * `C:\Users\Jane Doe\…` — arrives as two arguments and the override silently
 * fails, and an `&` in the value is read as a command separator. Passing an
 * argv array with no shell avoids the quoting question entirely.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SPEC =
  "https://raw.githubusercontent.com/FaultMaven/faultmaven/main/docs/reference/api/openapi.json";

const USAGE = "usage: node scripts/generate-api-types.mjs [--spec <path-or-url>]";

// Unrecognised arguments are rejected rather than ignored. A typo'd or
// `--spec=`-style flag that silently fell through to the default would
// overwrite the checked-in client with `main`'s types while the developer
// believed they were generating from their branch — the exact silent-wrong-
// client failure this script exists to prevent.
function parseSpec(argv) {
  let spec;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") {
      spec = argv[i + 1];
      if (!spec) {
        console.error(`--spec needs a path or URL\n${USAGE}`);
        process.exit(1);
      }
      i += 1;
    } else if (arg.startsWith("--spec=")) {
      spec = arg.slice("--spec=".length);
      if (!spec) {
        console.error(`--spec needs a path or URL\n${USAGE}`);
        process.exit(1);
      }
    } else {
      console.error(`unrecognised argument: ${arg}\n${USAGE}`);
      process.exit(1);
    }
  }
  return spec;
}

const spec = parseSpec(process.argv.slice(2)) || process.env.FM_OPENAPI_SPEC || DEFAULT_SPEC;

// Anchored to the repo, not the caller's cwd. A relative output path would
// write a stray file and exit 0 when the script is run from a subdirectory,
// leaving the tracked one stale and the drift gate red for no visible reason.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repoRoot, "src", "types", "api.generated.ts");

// Resolve the generator's own declared entrypoint. `openapi-typescript/bin/cli.js`
// is not resolvable directly — the package's `exports` map does not expose it —
// so go via package.json, which it does export.
const require = createRequire(import.meta.url);
let cli;
try {
  const pkgPath = require.resolve("openapi-typescript/package.json");
  const { bin } = require(pkgPath);
  const relative = typeof bin === "string" ? bin : bin["openapi-typescript"];
  cli = path.join(path.dirname(pkgPath), relative);
} catch (error) {
  console.error(
    `Could not locate openapi-typescript (${error.message}). Run: pnpm install`,
  );
  process.exit(1);
}

console.log(`Generating ${path.relative(repoRoot, out)} from ${spec}`);

const result = spawnSync(process.execPath, [cli, spec, "-o", out], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run openapi-typescript: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
