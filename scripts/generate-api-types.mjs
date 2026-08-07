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

const DEFAULT_SPEC =
  "https://raw.githubusercontent.com/FaultMaven/faultmaven/main/docs/reference/api/openapi.json";

const flagIndex = process.argv.indexOf("--spec");
if (flagIndex !== -1 && !process.argv[flagIndex + 1]) {
  console.error("--spec needs a path or URL");
  process.exit(1);
}

const spec =
  (flagIndex !== -1 && process.argv[flagIndex + 1]) ||
  process.env.FM_OPENAPI_SPEC ||
  DEFAULT_SPEC;
const out = "src/types/api.generated.ts";

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

console.log(`Generating ${out} from ${spec}`);

const result = spawnSync(process.execPath, [cli, spec, "-o", out], {
  stdio: "inherit",
});

if (result.error) {
  console.error(`Failed to run openapi-typescript: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
