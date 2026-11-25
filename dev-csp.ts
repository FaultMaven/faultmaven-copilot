/**
 * `csp` with the WebSocket source of the dev server at `serverOrigin` added to
 * `connect-src` (fm#2871): `ws:` for an `http:` origin, `wss:` for `https:`,
 * on the origin's host and port. Never narrows: a `connect-src` of only
 * `'none'` is replaced by the source; without `connect-src`, one is added
 * holding `default-src`'s sources plus this one, and without either the CSP
 * already admits every connection and is returned unchanged. Other
 * directives, their order and a trailing `;` are kept; a source already listed
 * changes nothing. An origin that does not parse, is not http(s), or has an
 * IPv6-literal host (CSP host-sources have no syntax for one) returns `csp`
 * unchanged.
 */
export function withDevServerSocket(csp: string, serverOrigin: string): string {
  let url: URL;
  try {
    url = new URL(serverOrigin);
  } catch {
    return csp;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return csp;
  if (url.hostname.startsWith('[')) return csp;
  // `host`, not `hostname:port`: a default port is empty, and `wss://h:` is not a source.
  const source = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;

  const parts = csp.split(';');
  const find = (name: string) => parts.findIndex((part) => part.trim().split(/\s+/)[0]?.toLowerCase() === name);
  const valuesAt = (at: number) => parts[at].trim().split(/\s+/).slice(1);
  const isNone = (value: string) => value.toLowerCase() === "'none'";
  const at = find('connect-src');
  if (at === -1) {
    const fallback = find('default-src');
    if (fallback === -1) return csp;
    const directive = ['connect-src', ...valuesAt(fallback).filter((value) => !isNone(value)), source].join(' ');
    const head = csp.trimEnd();
    return head.endsWith(';') ? `${head} ${directive};` : `${head}; ${directive}`;
  }
  const listed = valuesAt(at);
  if (listed.some((value) => value.toLowerCase() === source)) return csp;
  parts[at] = listed.length === 1 && isNone(listed[0]) ? parts[at].replace(listed[0], source) : `${parts[at].trimEnd()} ${source}`;
  return parts.join(';');
}
