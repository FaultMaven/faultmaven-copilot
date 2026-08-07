#!/usr/bin/env node
/**
 * Regenerate src/types/api.generated.ts from the API's OpenAPI spec.
 *
 * Defaults to faultmaven's committed spec on `main` — the same source CI
 * compares against — rather than a sibling working tree. A sibling checkout is
 * whatever branch someone left it on, so defaulting to it meant the documented
 * command could silently produce a client for an API that does not exist.
 *
 * Override with FM_OPENAPI_SPEC to generate from a local file or a branch:
 *
 *   FM_OPENAPI_SPEC=../faultmaven/docs/reference/api/openapi.json pnpm generate:api-types
 *
 * Written as a script rather than inline `${FM_OPENAPI_SPEC:-...}` in
 * package.json because cmd.exe does not expand that syntax: on Windows the
 * literal string was passed as the filename and the override was inert.
 */
import { spawnSync } from "node:child_process";

const DEFAULT_SPEC =
  "https://raw.githubusercontent.com/FaultMaven/faultmaven/main/docs/reference/api/openapi.json";

const spec = process.env.FM_OPENAPI_SPEC || DEFAULT_SPEC;
const out = "src/types/api.generated.ts";

console.log(`Generating ${out} from ${spec}`);

const result = spawnSync("openapi-typescript", [spec, "-o", out], {
  stdio: "inherit",
  shell: process.platform === "win32",
});

if (result.error) {
  console.error(`Failed to run openapi-typescript: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
