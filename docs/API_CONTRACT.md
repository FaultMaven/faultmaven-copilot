# The API contract this client is written against

`packages/copilot-ui/types/api.generated.ts` is **generated** from the FaultMaven
API's committed `docs/reference/api/openapi.json` — never edit it by hand. It
lives in the package, not in `src/`: a repo-wide find returns exactly one
`api.generated.ts`.

```bash
pnpm generate:api-types
```

By default the generator (`scripts/generate-api-types.mjs`) reads the spec from
the core commit pinned in `api-contract.pin.json` — the same file the
`api-types-drift` CI job reads, so the local command and the gate cannot
disagree about which contract is in force. It does **not** follow the API
repository's `main`: a backend merge reaches this client only when a pull
request here moves `ref` (and `contractVersion` to match), and that commit is
where this repository accepts the change.

To build against a contract you have not adopted, point the generator elsewhere.
`--spec` works identically on every platform:

```bash
pnpm generate:api-types --spec ../faultmaven/docs/reference/api/openapi.json
```

`FM_OPENAPI_SPEC` does the same and is what CI sets. The environment-prefix form
is POSIX-only:

```bash
FM_OPENAPI_SPEC=../faultmaven/docs/reference/api/openapi.json pnpm generate:api-types   # bash/zsh
```

```text
set FM_OPENAPI_SPEC=..\faultmaven\docs\reference\api\openapi.json && pnpm generate:api-types   :: cmd.exe
$env:FM_OPENAPI_SPEC = "..\faultmaven\docs\reference\api\openapi.json"; pnpm generate:api-types   # PowerShell
```

Prefer `--spec`.

**Do not generate from a live server** (`http://localhost:8090/openapi.json`).
Generating against whatever build happens to be running is how this repository
and the Dashboard ended up with different names for the same schema (fm#880).

## What turns `api-types-drift` red

A spec change in the API repository does **not**: the job regenerates from the
pinned commit, so merging there reaches nothing here. The job goes red when the
generated file stops matching the contract this repository pins — `ref` moved
without a regeneration, or the generated file was edited by hand. Adopt a new
contract in a PR of its own, pin and regenerated types together, rather than
folding it into unrelated work.

## Paired PRs: preparing before the spec reaches `main`

The warning above is about *provenance*, not the branch name. Generating from
the **committed `openapi.json` on the core PR** is correct and is the normal way
to get ready for a spec change that has not merged yet:

1. The core PR commits its regenerated `openapi.json`.
2. Here, generate with `--spec` pointed at that PR's committed spec, so the
   branch compiles and its tests run against the proposed contract.
3. Merge the core PR. Then adopt: move `ref` in `api-contract.pin.json` to the
   commit now on `main`, regenerate against it, and commit the two together.

Preparing and adopting are separate acts, and only the second is a contract
change. A branch that merely prepares leaves the pin alone, so `api-types-drift`
stays **green** on it. Never edit the generated client by hand to make the gate
look right in either state.

To tell a prepared branch apart from a genuine drift failure, regenerate with
`--spec` pointed at the core PR's committed spec and diff against the branch's
committed file. An empty diff means the types match the proposed contract; a
non-empty one means they came from somewhere else — a live server or an
unrelated build — which is the fm#880 failure mode.

## Pin parity with the Dashboard

The Dashboard keeps its own `api-contract.pin.json` and its own drift job, and
additionally asserts that its `ref` / `contractVersion` equal those of the
installed `@faultmaven/copilot-ui`. See "The pin-parity assertion" in
[HOST_INDEPENDENT_UI.md](HOST_INDEPENDENT_UI.md).
