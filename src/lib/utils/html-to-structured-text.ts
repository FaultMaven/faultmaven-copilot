/**
 * htmlToStructuredText
 *
 * Converts a live DOM into structured plain text before uploading to the
 * FaultMaven backend.  Semantic structure is preserved as markdown; all
 * HTML tags are removed.
 *
 * Output is markdown with heading-delimited sections.  Sections containing
 * error/alert signals are promoted to the top (static priority pass) so
 * that downstream char-budget truncation drops low-priority content first.
 *
 * The backend context builder can later split on `\n## ` for query-time
 * reranking without a format change.
 *
 * Uses getComputedStyle — must run in a browser context (content script or
 * scripting.executeScript).
 */

const MAX_CHARS = 12_000;

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'IFRAME',
  'HEAD', 'META', 'LINK', 'TEMPLATE',
]);

// Error keywords for the static priority pass.
// Primary signal — tool-agnostic, works across Grafana/Datadog/Sentry/PagerDuty.
const ERROR_KEYWORDS = /\b(firing|critical|error|down|failed|failure|anomaly|alert|warning|fatal|exception|timeout|unhealthy|degraded|outage)\b/i;

// Numeric values with monitoring units — used by tryStatValue to detect
// large-font stat panels (Grafana stat panels, Datadog big numbers).
const STAT_UNIT = /\d[\d.,]*\s*(%|ms|[μu]?s|min|h|req\/s|ops\/s|err\/s|[KMGT]?B|[KMB]\b|Hz|rpm|p\d{2})/i;

// ── Public API ───────────────────────────────────────────────────────

interface StructuredTextOptions {
  maxChars?: number;
  includePageTitle?: boolean;
}

export function htmlToStructuredText(
  root: Document | Element,
  opts: StructuredTextOptions = {},
): string {
  const maxChars = opts.maxChars ?? MAX_CHARS;
  const includeTitle = opts.includePageTitle ?? true;

  const doc: Document = root instanceof Document ? root : root.ownerDocument!;
  const body: Element =
    root instanceof Document
      ? root.body ?? root.documentElement
      : root.tagName === 'BODY'
        ? root
        : root.querySelector('body') ?? root;

  // ── Preamble (fixed header — never reordered) ──────────────────────
  const preamble: string[] = [];
  preamble.push(`[captured_at: ${new Date().toISOString()}]`);

  if (includeTitle) {
    const pageTitle =
      doc.title?.trim() || body.querySelector('h1')?.textContent?.trim();
    if (pageTitle) preamble.push(`# ${pageTitle}`);

    const meta = doc
      .querySelector('meta[name="description"]')
      ?.getAttribute('content')
      ?.trim();
    if (meta) preamble.push(meta);
  }

  // ── Walk body ──────────────────────────────────────────────────────
  const pageTitle = doc.title?.trim() || '';
  const allLines: string[] = [];
  walkNode(body, allLines, pageTitle);

  // ── Static priority pass: error sections first ─────────────────────
  const sections = splitIntoSections(allLines);
  const errorSections: string[][] = [];
  const normalSections: string[][] = [];

  for (const section of sections) {
    if (hasErrorSignal(section)) {
      errorSections.push(section);
    } else {
      normalSections.push(section);
    }
  }

  const ordered = [...errorSections, ...normalSections];

  // ── Assemble and cap ───────────────────────────────────────────────
  const result = [...preamble, '', ...ordered.flat()]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);

  return result;
}

// ── Section splitting and priority ───────────────────────────────────

/**
 * Split flat line array into sections on ## headings.
 * Lines before the first ## heading become a leading section that is
 * always kept at the front (not subject to priority sorting).
 */
function splitIntoSections(lines: string[]): string[][] {
  const sections: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    // Split on h2+ headings (h1 is page title, handled in preamble)
    if (/^#{2,6}\s/.test(line) && current.length > 0) {
      sections.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    sections.push(current);
  }

  return sections;
}

/**
 * Check if a section contains error/alert signals.
 * Primary signal: text keywords (tool-agnostic).
 * ARIA alert elements emit "## Alert" headings during the walk,
 * which naturally match here via the "alert" keyword.
 */
function hasErrorSignal(sectionLines: string[]): boolean {
  const text = sectionLines.join(' ');
  return ERROR_KEYWORDS.test(text);
}

// ── Node walker ──────────────────────────────────────────────────────

function walkNode(
  node: Element,
  out: string[],
  pageTitle: string,
): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const t = child.textContent?.trim();
      if (t) out.push(t);
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const el = child as Element;
    const tag = el.tagName;

    if (SKIP_TAGS.has(tag)) continue;
    if (isHidden(el)) continue;

    switch (tag) {
      case 'H1': {
        // Skip if it matches the page title (already in preamble)
        const text = extractText(el);
        if (text !== pageTitle) {
          out.push(`# ${text}`);
        }
        break;
      }
      case 'H2':  out.push(`## ${extractText(el)}`);   break;
      case 'H3':
      case 'H4':  out.push(`### ${extractText(el)}`);  break;
      case 'H5':
      case 'H6':  out.push(`#### ${extractText(el)}`); break;

      case 'PRE':
      case 'CODE': {
        const code = extractText(el).trim();
        if (code) out.push(`\`\`\`\n${code}\n\`\`\``);
        break;
      }

      case 'TABLE':
        extractTable(el, out);
        break;

      case 'UL':
      case 'OL':
        extractList(el, out, tag === 'OL');
        break;

      case 'DL':
        extractDefinitionList(el, out);
        break;

      case 'P':
      case 'BLOCKQUOTE': {
        const t = extractText(el).trim();
        if (t) out.push(t);
        break;
      }

      case 'LI': {
        const t = extractText(el).trim();
        if (t) out.push(`- ${t}`);
        break;
      }

      case 'DETAILS': {
        const summary = el.querySelector('summary');
        if (summary) out.push(`### ${extractText(summary)}`);
        for (const c of Array.from(el.children)) {
          if (c.tagName !== 'SUMMARY') walkNode(c, out, pageTitle);
        }
        break;
      }

      case 'FORM':
        extractFormValues(el, out);
        break;

      default: {
        // ARIA alert elements: wrap in an "Alert" section so the
        // priority pass naturally promotes them.
        if (
          el.getAttribute('role') === 'alert' ||
          el.getAttribute('aria-live') === 'assertive'
        ) {
          out.push('## Alert');
          walkNode(el, out, pageTitle);
          break;
        }

        // Key-value heuristic (child count + label pattern)
        if (tryKeyValue(el, out)) break;

        // Stat value heuristic (large font + numeric unit)
        if (tryStatValue(el, out)) break;

        // Recurse
        walkNode(el, out, pageTitle);
        break;
      }
    }
  }
}

// ── Element extractors ───────────────────────────────────────────────

function extractTable(table: Element, out: string[]): void {
  const rows = Array.from(table.querySelectorAll('tr'));
  if (!rows.length) return;

  const grid = rows.map(row =>
    Array.from(row.querySelectorAll('th, td')).map(cell =>
      extractText(cell).trim().replace(/\s+/g, ' '),
    ),
  );
  if (!grid.length || !grid[0].length) return;

  // 2-column tables render as key: value pairs (more token-efficient)
  const isKV = grid[0].length === 2 && grid.every(r => r.length === 2);

  if (isKV) {
    for (const [label, value] of grid) {
      if (label || value) out.push(`${label}: ${value}`);
    }
  } else {
    const colWidths = grid[0].map((_, i) =>
      Math.min(30, Math.max(...grid.map(r => (r[i] ?? '').length))),
    );
    const formatRow = (row: string[]) =>
      '| ' + row.map((cell, i) => cell.padEnd(colWidths[i])).join(' | ') + ' |';
    const separator =
      '| ' + colWidths.map(w => '-'.repeat(w)).join(' | ') + ' |';

    out.push(formatRow(grid[0]));
    out.push(separator);
    for (const row of grid.slice(1)) {
      out.push(formatRow(row));
    }
  }
  out.push('');
}

function extractList(list: Element, out: string[], ordered: boolean): void {
  let i = 1;
  for (const item of Array.from(list.querySelectorAll(':scope > li'))) {
    const prefix = ordered ? `${i++}. ` : '- ';
    const text = extractText(item).trim().replace(/\s+/g, ' ');
    if (text) out.push(`${prefix}${text}`);
  }
}

function extractDefinitionList(dl: Element, out: string[]): void {
  const children = Array.from(dl.children);
  let currentTerm: string | null = null;
  for (const child of children) {
    const tag = child.tagName;
    if (tag === 'DT') {
      currentTerm = extractText(child).trim();
    } else if (tag === 'DD' && currentTerm) {
      const val = extractText(child).trim();
      if (val) out.push(`${currentTerm}: ${val}`);
    }
  }
}

function extractFormValues(form: Element, out: string[]): void {
  const inputs = form.querySelectorAll('input, select, textarea');
  for (const input of Array.from(inputs)) {
    if (isHidden(input)) continue;
    const label = findLabel(input as HTMLInputElement, form);
    const value = getInputValue(input);
    if (value) {
      out.push(label ? `${label}: ${value}` : value);
    }
  }
}

// ── Key-value heuristic ──────────────────────────────────────────────
//
// Detects patterns like:
//   <div class="metric"><span>CPU Usage</span><span>92%</span></div>
//   <div><label>Status</label><span>FIRING</span></div>

function tryKeyValue(el: Element, out: string[]): boolean {
  const children = Array.from(el.children).filter(c => !isHidden(c));

  if (children.length < 2 || children.length > 4) return false;

  // All children must be inline-ish (no nested block structure)
  if (!children.every(c => isLeafLike(c))) return false;

  const texts = children.map(c => extractText(c).trim());
  if (texts.some(t => t.length === 0)) return false;

  // First child is label-like (shorter, doesn't start with a digit)
  const [label, ...values] = texts;
  if (label.length >= 60 || /^\d/.test(label)) return false;

  out.push(`${label}: ${values.join(' ')}`);
  return true;
}

// ── Stat value heuristic ─────────────────────────────────────────────
//
// Catches large-font numeric stat panels that tryKeyValue misses.
// Grafana stat panels, Datadog big number widgets, etc.
// Requires fontSize >= 24px AND a numeric value with a monitoring unit.

function tryStatValue(el: Element, out: string[]): boolean {
  const children = Array.from(el.children).filter(c => !isHidden(c));
  if (children.length < 1 || children.length > 4) return false;

  // Find the child with largest font-size that has a numeric unit value
  let statChild: Element | null = null;
  let statSize = 0;

  for (const c of children) {
    const text = (c.textContent ?? '').trim();
    if (!STAT_UNIT.test(text)) continue;

    const fontSize = parseFloat(window.getComputedStyle(c).fontSize);
    if (fontSize >= 24 && fontSize > statSize) {
      statChild = c;
      statSize = fontSize;
    }
  }

  if (!statChild) return false;

  const value = (statChild.textContent ?? '').trim();

  // Remaining children are the label
  const labelParts = children
    .filter(c => c !== statChild)
    .map(c => extractText(c).trim())
    .filter(t => t.length > 0 && t.length < 60);

  const label = labelParts.join(' ');
  out.push(label ? `${label}: ${value}` : value);
  return true;
}

// ── Helpers ──────────────────────────────────────────────────────────

function extractText(el: Element): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function isHidden(el: Element): boolean {
  try {
    const style = window.getComputedStyle(el);
    return (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      style.opacity === '0' ||
      (el as HTMLElement).hidden ||
      el.getAttribute('aria-hidden') === 'true'
    );
  } catch {
    return false;
  }
}

function isLeafLike(el: Element): boolean {
  const blockTags = new Set([
    'DIV', 'SECTION', 'ARTICLE', 'TABLE', 'UL', 'OL', 'PRE',
  ]);
  return !Array.from(el.querySelectorAll('*')).some(c =>
    blockTags.has(c.tagName),
  );
}

function findLabel(
  input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  container: Element,
): string | null {
  // 1. <label for="id">
  if (input.id) {
    const label = container.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label) return extractText(label);
  }
  // 2. Wrapping <label>
  const parent = input.closest('label');
  if (parent) {
    const clone = parent.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('input, select, textarea').forEach(i => i.remove());
    return extractText(clone);
  }
  // 3. Fallbacks
  return (
    input.getAttribute('aria-label') ||
    input.getAttribute('placeholder') ||
    input.name ||
    null
  );
}

function getInputValue(input: Element): string | null {
  const tag = input.tagName;
  if (tag === 'SELECT') {
    return Array.from((input as HTMLSelectElement).selectedOptions)
      .map(o => o.text)
      .join(', ');
  }
  if (tag === 'TEXTAREA') return (input as HTMLTextAreaElement).value.trim();

  const inp = input as HTMLInputElement;
  if (inp.type === 'checkbox' || inp.type === 'radio') {
    return inp.checked ? (inp.value || 'checked') : null;
  }
  return inp.value?.trim() || null;
}
