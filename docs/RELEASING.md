# Releasing FaultMaven Copilot

The Chrome Web Store reviews the **packaged artifact**, not this repository.
Most changes here never reach it. This document says which do, and what each
kind costs.

## Three kinds of change

| | Example | What it needs |
|---|---|---|
| **A — the package changed** | anything reaching the build: `src/`, `public/`, `wxt.config.ts`, a runtime dependency | version bump → tag → upload → store review |
| **B — the listing changed** | store description, screenshots, privacy-policy URL, permission justifications | edit in the store dashboard → review. **No** version bump; the package is untouched |
| **C — neither** | `README.md`, `docs/`, CI, unit tests, e2e | nothing |

Do not decide between these by reading the diff. A path allowlist fails **open**
— a new source directory nobody thought to add looks like category C. CI decides
it from the artifact instead (below).

## The resubmission guard

`extension-baseline.json` records the shipped Chrome build: an aggregate SHA-256
over the built tree, and the manifest's permission surface. The `build` job runs
`pnpm extension:digest`, which rebuilds and compares.

- **Passes** → nothing that ships changed. The change is category C.
- **Fails** → the artifact changed. Category A. Accept it *in the same PR*:

  ```bash
  pnpm zip && pnpm extension:digest:write
  ```

  Committing the new baseline is what makes the change reviewable, and it gives
  `git log extension-baseline.json` a true history of every package change since
  the last release tag — which is how you answer "is an upload owed?"

**Generated icons are handled separately, and deliberately.** `generate-icons`
renders 4 SVGs x 7 sizes through sharp at build time, and sharp's PNG encoder is
not byte-reproducible across platforms — measured: a CI runner and a dev machine
agreed on all other files and disagreed on exactly those 28. Hashing the rendered
PNGs would red every PR while proving nothing.

Only those 28 are exempt, and the set comes from the generator's own
`ICON_SIZES` / `VARIANTS` rather than from a path prefix — `public/icon/` holds
32 PNGs, and the four `px64-*` are committed rather than rendered, so they are
hashed like any other shipped file. What a *generated* icon is comes from the
SVG sources, the generator, and the **sharp version** that renders them; all
three are hashed, so a sharp bump that re-renders every icon is caught. The icon
inventory is compared too, so adding or dropping a size still fires.

Generate the baseline from a **clean** build (`rm -rf .output && pnpm zip`). A
stale `.output` bakes whatever is lying there into the baseline; CI rebuilds from
a fresh checkout and will reject it, but that costs a round trip.

The guard shouts louder when the **manifest surface** changes — permissions,
host permissions, CSP. Store review compares those against the listing's
justification text, so that case is category A **and** category B: ship the
package *and* update the listing, or the two disagree and review flags it.

Only the Chrome build is tracked. It is the published target; the Firefox output
is built and attached to GitHub releases but is not distributed through a store,
so it has no resubmission to guard.

## Cutting a release

The version has one source: `package.json`. `wxt.config.ts` no longer sets one,
and WXT's fallback for a missing version is a warn-only `0.0.0` — so CI asserts
the built manifest matches `package.json` at PR time rather than at upload.

```bash
# 1. bump the version (semver: patch for fixes, minor for features)
#    and refresh the baseline in the same commit
vim package.json
pnpm zip && pnpm extension:digest:write

# 2. merge, then tag the merge commit
git tag v1.2.3 && git push origin v1.2.3
```

The tag fires `.github/workflows/release.yml`, which builds both targets and
creates a **GitHub Release** with the zips attached. Prerelease-suffixed tags
(`v1.2.3-rc.1`) are rejected: WXT strips the suffix from the manifest, so the rc
would collide with its final at store upload.

**Uploading to the store is manual.** Nothing in CI talks to the Chrome Web
Store. Take `faultmaven-copilot-<version>-chrome.zip` from the GitHub Release,
upload it in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole),
and submit for review.

## After a store upload

Note the released version in the PR or release notes that carried it. Between
uploads, `git log extension-baseline.json` since that release tag lists every
change to the artifact — an empty log means nothing is owed; a non-empty one
means the store is behind `main`.
