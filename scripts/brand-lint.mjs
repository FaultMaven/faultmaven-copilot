#!/usr/bin/env node
/**
 * Brand-messaging terminology lint (downstream check).
 *
 * Canonical source: `.claude/skills/brand-messaging.md` (§3 terminology, §7
 * enforcement) in the faultmaven repo. This is the downstream copy for the
 * Copilot extension, scoped to its brand surface (the README). Stdlib only.
 *
 * Two pattern classes, per the skill's "Authority by rule type":
 *   - UNIVERSAL : terminology — must not appear on any brand-facing surface.
 *   - CORE_ONLY : positioning/audience/tone — core product surfaces (README).
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
  [/\bmicroservices?\s+backend\b/i, 'FaultMaven is a modular monolith, not microservices'],
  [/\bLocal Deployment\b/i, "use 'Standalone' (ADR-004); 'local' is reserved for AUTH_MODE/CHAT_PROVIDER"],
  [/\bdeploy locally\b/i, "use 'self-host' / 'Standalone' (ADR-004)"],
  [/\bEnterprise SaaS\b/i, "use 'FaultMaven Cloud'; there is no Enterprise tier"],
  [/\bfaultmaven-deploy\b/i, 'obsolete repo — do not reference'],
  [/\bfm-[a-z]+-service\b/i, 'obsolete microservice repo — do not reference'],
];

const CORE_ONLY = [
  [/\bfor SRE teams\b/i, "don't narrow the audience to one role (brand §4)"],
  [/\bdesigned for DevOps\b/i, "don't narrow the audience to one role (brand §4)"],
  [/\bleverages?\b/i, "use a precise verb (uses/reads/queries…), not 'leverage' (brand §5)"],
  [/\butiliz(?:e|es|ed|ing|ation)\b/i, "use 'use', not 'utilize' (brand §5)"],
];

const BRAND_FILES = ['README.md'];

function scan(rel, rules, hits) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return;
  const lines = readFileSync(abs, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes(ALLOW)) return;
    for (const [re, msg] of rules) {
      if (re.test(line)) hits.push(`${rel}:${i + 1}: ${msg}`);
    }
  });
}

const hits = [];
for (const f of BRAND_FILES) scan(f, [...UNIVERSAL, ...CORE_ONLY], hits);

if (hits.length) {
  console.error('Brand-messaging lint failed (canonical: faultmaven/.claude/skills/brand-messaging.md):\n');
  for (const h of hits) console.error(`  ${h}`);
  console.error("\nFix the wording, or append 'brand-lint: allow' to the line for a deliberate, justified use.");
  process.exit(1);
}
console.log('Brand-messaging lint passed.');
