#!/usr/bin/env node
/**
 * Brand-messaging terminology lint (downstream check).
 *
 * Canonical source: `.claude/skills/brand-messaging.md` (§3 terminology, §7
 * enforcement) in the faultmaven repo. This is the downstream copy for the
 * Copilot extension. Stdlib only.
 *
 * Two pattern classes, per the skill's "Authority by rule type", each with its
 * own file list:
 *   - UNIVERSAL : terminology — every brand-facing surface, prose or not.
 *   - CORE_ONLY : positioning/audience/tone. Canonical applies these to its own
 *     manifest (pyproject.toml) and excludes only CLAUDE.md, a dev guide — so
 *     excluding package.json here is a JS-ecosystem judgement, NOT canonical's
 *     rule: package.json carries dependency names and npm scripts, where
 *     'leverage'/'utilize' show up as third-party names nobody can rename, and
 *     JSON has no comment syntax, so the 'brand-lint: allow' escape hatch below
 *     cannot reach them.
 *
 * The extension's src/ is application code / UI copy (a product-design concern,
 * out of brand-skill scope), so it is not scanned. 'AIOps platform' /
 * 'observability platform' / 'playbook' are intentionally NOT grepped — they're
 * used by contrast; enforced by review.
 *
 * Put 'brand-lint: allow' on a line to whitelist a deliberate, justified use.
 * When retiring a NEW term, add it here AND to brand-messaging.md §7 together.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ALLOW = 'brand-lint: allow';

const UNIVERSAL = [
  [/\btroubleshooting assistant\b/i, "use 'troubleshooting copilot', not 'troubleshooting assistant'"],
  // Retired overclaim (#821): FaultMaven has no reach into production — it works
  // from what you paste, upload or capture.
  [/\blive telemetry\b/i, "FaultMaven reads no live telemetry — say 'the logs, metrics, and configs you share'"],
  [/\bmicroservices?\s+backend\b/i, 'FaultMaven is a modular monolith, not microservices'],
  [/\bLocal Deployment\b/i, "use 'Standalone' (ADR-004); 'local' is reserved for AUTH_MODE/CHAT_PROVIDER"],
  [/\bdeploy locally\b/i, "use 'self-host' / 'Standalone' (ADR-004)"],
  [/\bEnterprise SaaS\b/i, "use 'FaultMaven Cloud'; there is no Enterprise tier"],
  [/\bCommunity Edition\b/i, "retired tier name — use 'Standalone' (one unified codebase)"],
  [/\bEnterprise Edition\b/i, "retired tier name — use 'Cloud' (one unified codebase)"],
  [/\bfaultmaven-deploy\b/i, 'obsolete repo — do not reference'],
  // The exemption names the ONE thing it exempts: the fm-provision-service-account
  // console entrypoint (faultmaven#887), singular or plural. A bare (?!-) also let
  // fm-case-service-v2 and fm-agent-service-archive through, which ARE retired
  // repo names. Kept in step with canonical via faultmaven#1148.
  [/\bfm-[a-z]+-service\b(?!-accounts?\b)/i, 'obsolete microservice repo — do not reference'],
];

const CORE_ONLY = [
  [/\bfor SRE teams\b/i, "don't narrow the audience to one role (brand §4)"],
  [/\bdesigned for DevOps\b/i, "don't narrow the audience to one role (brand §4)"],
  [/\bleverages?\b/i, "use a precise verb (uses/reads/queries…), not 'leverage' (brand §5)"],
  [/\butiliz(?:e|es|ed|ing|ation)\b/i, "use 'use', not 'utilize' (brand §5)"],
];

// Terminology binds every brand-facing surface: the README, the published
// privacy policy, and the two files carrying the STORE-FACING description —
// package.json's `description`, and the locale bundle supplying the extension's
// `name`/`description` to Chrome and Firefox.
const UNIVERSAL_FILES = [
  'README.md',
  'PRIVACY.md',
  'package.json',
  'public/_locales/en/messages.json',
];
// Tone/positioning rules apply to prose only — see the CORE_ONLY note above.
const CORE_FILES = ['README.md', 'PRIVACY.md'];

// JSON has no comment syntax, so the ALLOW marker cannot be placed on an
// offending line without altering the shipped value. Terminology still applies
// there — a retired name must not reach published metadata — so the rule stays
// and only the GUIDANCE changes: point at the real remedy instead of an escape
// hatch that isn't usable. Suppression itself is untouched.
const isJson = (rel) => rel.endsWith('.json');

function scan(rel, rules, hits) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW)) return;
    for (const [re, msg] of rules) {
      if (re.test(line)) hits.push({ rel, line: i + 1, msg, json: isJson(rel) });
    }
  });
}

const hits = [];
for (const f of UNIVERSAL_FILES) scan(f, UNIVERSAL, hits);
for (const f of CORE_FILES) scan(f, CORE_ONLY, hits);

if (hits.length) {
  console.error('Brand-messaging lint failed (canonical: faultmaven/.claude/skills/brand-messaging.md):\n');
  for (const h of hits) {
    const note = h.json ? '  (JSON — the marker cannot go on this line without changing the value; fix the value)' : '';
    console.error(`  ${h.rel}:${h.line}: ${h.msg}${note}`);
  }
  // Only offer the escape hatch if some hit can actually use it.
  if (hits.some((h) => !h.json)) {
    console.error("\nFix the wording, or append 'brand-lint: allow' to the line for a deliberate, justified use.");
  } else {
    console.error('\nFix the wording.');
  }
  process.exit(1);
}
console.log('Brand-messaging lint passed.');
