import { useState } from 'react';
import { browser } from 'wxt/browser';
import { createLogger } from '../../../lib/utils/logger';

const log = createLogger('usePageContent');

export function usePageContent() {
  const [pageContent, setPageContent] = useState<string>("");
  const [injectionStatus, setInjectionStatus] = useState<{ message: string; type: 'success' | 'error' | '' }>({ message: "", type: "" });

  const getPageContent = async (): Promise<string> => {
    try {
      setInjectionStatus({ message: "🔄 Analyzing page content...", type: "" });
      const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

      if (!tab.id) {
        throw new Error("No active tab found");
      }

      // Check if tab URL is valid for content script injection
      if (tab.url && (tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://') ||
          tab.url.startsWith('about:') || tab.url.startsWith('edge://') || tab.url.startsWith('brave://'))) {
        throw new Error("Cannot analyze browser internal pages (chrome://, about:, etc.)");
      }

      let capturedContent = '';

      try {
        // Try sending message to existing content script
        const response = await browser.tabs.sendMessage(tab.id, { action: "getPageContent" });

        if (response && response.content) {
          capturedContent = response.content;
          setPageContent(capturedContent);
          setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
          return capturedContent;
        }
      } catch (messageError: any) {
        // Content script not injected on this page — ensure we have host permission, then inject programmatically
        log.info("Content script not responding, attempting programmatic injection...");

        try {
          // Ensure we have host permission for this tab's origin
          // (activeTab only activates on toolbar icon click, not side-panel button clicks)
          if (tab.url) {
            const tabUrl = new URL(tab.url);
            const origin = `${tabUrl.protocol}//${tabUrl.host}/*`;

            const hasPermission = await browser.permissions.contains({ origins: [origin] });
            if (!hasPermission) {
              log.info("Requesting host permission for:", origin);
              const granted = await browser.permissions.request({ origins: [origin] });
              if (!granted) {
                throw new Error("Permission required to analyze this page. Please allow access when prompted.");
              }
            }
          }

          // Semantic text extraction — must be fully inline because
          // scripting.executeScript serializes the func (no imports).
          // Mirrors htmlToStructuredText from lib/utils/html-to-structured-text.ts.
          const [result] = await browser.scripting.executeScript({
            target: { tabId: tab.id },
            func: () => {
              const MAX_CHARS = 12_000;
              const SKIP = new Set([
                'SCRIPT','STYLE','NOSCRIPT','SVG','CANVAS','IFRAME',
                'HEAD','META','LINK','TEMPLATE',
              ]);
              const BLOCK = new Set([
                'DIV','SECTION','ARTICLE','TABLE','UL','OL','PRE',
              ]);
              const ERR_KW = /\b(firing|critical|error|down|failed|failure|anomaly|alert|warning|fatal|exception|timeout|unhealthy|degraded|outage)\b/i;
              const STAT_UNIT = /\d[\d.,]*\s*(%|ms|[μu]?s|min|h|req\/s|ops\/s|err\/s|[KMGT]?B|[KMB]\b|Hz|rpm|p\d{2})/i;

              function txt(el: Element): string {
                return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
              }
              function hidden(el: Element): boolean {
                try {
                  const s = window.getComputedStyle(el);
                  return s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0'
                    || (el as HTMLElement).hidden || el.getAttribute('aria-hidden') === 'true';
                } catch { return false; }
              }
              function leafLike(el: Element): boolean {
                return !Array.from(el.querySelectorAll('*')).some(c => BLOCK.has(c.tagName));
              }
              function tryKV(el: Element, out: string[]): boolean {
                const ch = Array.from(el.children).filter(c => !hidden(c));
                if (ch.length < 2 || ch.length > 4) return false;
                if (!ch.every(c => leafLike(c))) return false;
                const ts = ch.map(c => txt(c));
                if (ts.some(t => !t)) return false;
                const [label, ...vals] = ts;
                if (label.length >= 60 || /^\d/.test(label)) return false;
                out.push(`${label}: ${vals.join(' ')}`);
                return true;
              }
              function tryStat(el: Element, out: string[]): boolean {
                const ch = Array.from(el.children).filter(c => !hidden(c));
                if (ch.length < 1 || ch.length > 4) return false;
                let best: Element | null = null;
                let bestSz = 0;
                for (const c of ch) {
                  const t = (c.textContent ?? '').trim();
                  if (!STAT_UNIT.test(t)) continue;
                  const sz = parseFloat(window.getComputedStyle(c).fontSize);
                  if (sz >= 24 && sz > bestSz) { best = c; bestSz = sz; }
                }
                if (!best) return false;
                const val = (best.textContent ?? '').trim();
                const lbl = ch.filter(c => c !== best).map(c => txt(c)).filter(t => t.length > 0 && t.length < 60).join(' ');
                out.push(lbl ? `${lbl}: ${val}` : val);
                return true;
              }
              function inputVal(el: Element): string | null {
                const tag = el.tagName;
                if (tag === 'SELECT')
                  return Array.from((el as HTMLSelectElement).selectedOptions).map(o => o.text).join(', ');
                if (tag === 'TEXTAREA') return (el as HTMLTextAreaElement).value.trim();
                const inp = el as HTMLInputElement;
                if (inp.type === 'checkbox' || inp.type === 'radio')
                  return inp.checked ? (inp.value || 'checked') : null;
                return inp.value?.trim() || null;
              }
              function findLabel(inp: HTMLInputElement, ctr: Element): string | null {
                if (inp.id) {
                  const l = ctr.querySelector(`label[for="${CSS.escape(inp.id)}"]`);
                  if (l) return txt(l);
                }
                const p = inp.closest('label');
                if (p) {
                  const c = p.cloneNode(true) as HTMLElement;
                  c.querySelectorAll('input,select,textarea').forEach(i => i.remove());
                  return txt(c);
                }
                return inp.getAttribute('aria-label') || inp.getAttribute('placeholder') || inp.name || null;
              }
              function tbl(tbl: Element, out: string[]) {
                const rows = Array.from(tbl.querySelectorAll('tr'));
                if (!rows.length) return;
                const grid = rows.map(r =>
                  Array.from(r.querySelectorAll('th,td')).map(c => txt(c).replace(/\s+/g, ' '))
                );
                if (!grid.length || !grid[0].length) return;
                if (grid[0].length === 2 && grid.every(r => r.length === 2)) {
                  for (const [k, v] of grid) { if (k || v) out.push(`${k}: ${v}`); }
                } else {
                  const w = grid[0].map((_, i) => Math.min(30, Math.max(...grid.map(r => (r[i]??'').length))));
                  const fmt = (r: string[]) => '| ' + r.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |';
                  out.push(fmt(grid[0]));
                  out.push('| ' + w.map(n => '-'.repeat(n)).join(' | ') + ' |');
                  for (const r of grid.slice(1)) out.push(fmt(r));
                }
                out.push('');
              }
              function lst(el: Element, out: string[], ordered: boolean) {
                let i = 1;
                for (const li of Array.from(el.querySelectorAll(':scope > li'))) {
                  const t = txt(li).replace(/\s+/g, ' ');
                  if (t) out.push(`${ordered ? `${i++}. ` : '- '}${t}`);
                }
              }
              function defList(el: Element, out: string[]) {
                let term: string | null = null;
                for (const c of Array.from(el.children)) {
                  if (c.tagName === 'DT') term = txt(c);
                  else if (c.tagName === 'DD' && term) { const v = txt(c); if (v) out.push(`${term}: ${v}`); }
                }
              }

              const pgTitle = document.title?.trim() || '';
              function walk(node: Element, out: string[]) {
                for (const child of Array.from(node.childNodes)) {
                  if (child.nodeType === 3) { const t = child.textContent?.trim(); if (t) out.push(t); continue; }
                  if (child.nodeType !== 1) continue;
                  const el = child as Element;
                  const tag = el.tagName;
                  if (SKIP.has(tag) || hidden(el)) continue;
                  switch (tag) {
                    case 'H1': { const t = txt(el); if (t !== pgTitle) out.push(`# ${t}`); break; }
                    case 'H2': out.push(`## ${txt(el)}`); break;
                    case 'H3': case 'H4': out.push(`### ${txt(el)}`); break;
                    case 'H5': case 'H6': out.push(`#### ${txt(el)}`); break;
                    case 'PRE': case 'CODE': { const c = txt(el); if (c) out.push('```\n'+c+'\n```'); break; }
                    case 'TABLE': tbl(el, out); break;
                    case 'UL': case 'OL': lst(el, out, tag === 'OL'); break;
                    case 'DL': defList(el, out); break;
                    case 'P': case 'BLOCKQUOTE': { const t = txt(el); if (t) out.push(t); break; }
                    case 'LI': { const t = txt(el); if (t) out.push(`- ${t}`); break; }
                    case 'DETAILS': {
                      const s = el.querySelector('summary');
                      if (s) out.push(`### ${txt(s)}`);
                      for (const c of Array.from(el.children)) { if (c.tagName !== 'SUMMARY') walk(c, out); }
                      break;
                    }
                    case 'FORM': {
                      for (const inp of Array.from(el.querySelectorAll('input,select,textarea'))) {
                        if (hidden(inp)) continue;
                        const lbl = findLabel(inp as HTMLInputElement, el);
                        const v = inputVal(inp);
                        if (v) out.push(lbl ? `${lbl}: ${v}` : v);
                      }
                      break;
                    }
                    default: {
                      if (el.getAttribute('role') === 'alert' || el.getAttribute('aria-live') === 'assertive') {
                        out.push('## Alert'); walk(el, out); break;
                      }
                      if (!tryKV(el, out) && !tryStat(el, out)) walk(el, out);
                      break;
                    }
                  }
                }
              }

              // Preamble (fixed header)
              const preamble: string[] = [`[captured_at: ${new Date().toISOString()}]`];
              const title = pgTitle || document.querySelector('h1')?.textContent?.trim();
              if (title) preamble.push(`# ${title}`);
              const meta = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim();
              if (meta) preamble.push(meta);

              // Walk + split into sections on ## headings
              const allLines: string[] = [];
              walk(document.body, allLines);

              const groups: string[][] = [];
              let cur: string[] = [];
              for (const line of allLines) {
                if (/^#{2,6}\s/.test(line) && cur.length > 0) { groups.push(cur); cur = [line]; }
                else cur.push(line);
              }
              if (cur.length > 0) groups.push(cur);

              // Error-first priority sort (stable — preserves DOM order within each group)
              const errG = groups.filter(g => ERR_KW.test(g.join(' ')));
              const nrmG = groups.filter(g => !ERR_KW.test(g.join(' ')));

              return [...preamble, '', ...errG.flat(), ...nrmG.flat()]
                .join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, MAX_CHARS);
            }
          });

          if (result && result.result) {
            capturedContent = result.result;
            setPageContent(capturedContent);
            setInjectionStatus({ message: "✅ Page content captured successfully!", type: "success" });
            return capturedContent;
          }
        } catch (injectionError: any) {
          log.error("Programmatic injection failed:", injectionError);

          const errorMsg = injectionError.message || "";

          // User denied the permission prompt
          if (errorMsg.includes("Permission required")) {
            throw injectionError;
          }

          // Still a permission error after request — likely the origin isn't in optional_host_permissions
          if (errorMsg.includes("Cannot access contents") || errorMsg.includes("manifest must request permission")) {
            throw new Error("Cannot analyze this page. The extension does not have permission to access it.");
          }

          throw new Error(`Cannot inject script: ${injectionError.message}`);
        }
      }

      throw new Error("Failed to capture page content");
    } catch (err: any) {
      log.error("getPageContent error:", err);
      const errorMsg = err.message || "Unknown error occurred";
      setInjectionStatus({
        message: `⚠️ ${errorMsg}. Please try refreshing the page.`,
        type: "error"
      });
      throw err; // Re-throw so caller knows it failed
    }
  };

  const handlePageInject = async (): Promise<string> => {
    // Capture the page content and return it directly (not from state)
    const content = await getPageContent();
    return content;
  };

  return {
    pageContent,
    injectionStatus,
    setInjectionStatus,
    handlePageInject
  };
}
