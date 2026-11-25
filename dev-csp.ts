/**
 * `csp` with the WebSocket source of the dev server at `serverOrigin` added to
 * `connect-src` (fm#2871): `ws:` for an `http:` origin, `wss:` for `https:`,
 * on the origin's host and port. A CSP without `connect-src` gains one. Other
 * directives, their order and a trailing `;` are kept; adding a source already
 * listed changes nothing. An origin that does not parse, or is not http(s),
 * returns `csp` unchanged.
 */
export function withDevServerSocket(csp: string, serverOrigin: string): string {
  let url: URL;
  try {
    url = new URL(serverOrigin);
  } catch {
    return csp;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return csp;
  // `host`, not `hostname:port`: a default port is empty, and `wss://h:` is not a source.
  const source = `${url.protocol === 'https:' ? 'wss:' : 'ws:'}//${url.host}`;

  const parts = csp.split(';');
  const at = parts.findIndex((part) => part.trim().split(/\s+/)[0]?.toLowerCase() === 'connect-src');
  if (at === -1) {
    const head = csp.trimEnd();
    if (head === '') return `connect-src ${source};`;
    return head.endsWith(';') ? `${head} connect-src ${source};` : `${head}; connect-src ${source}`;
  }
  if (parts[at].trim().split(/\s+/).slice(1).some((value) => value.toLowerCase() === source)) return csp;
  parts[at] = `${parts[at].trimEnd()} ${source}`;
  return parts.join(';');
}
