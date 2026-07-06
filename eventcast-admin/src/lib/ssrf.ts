/**
 * SSRF guards for server-side URL fetching (Edge-runtime safe).
 *
 * NOTE ON EDGE LIMITATION: Cloudflare Workers / Next-on-Pages have no
 * `node:dns`, so a public hostname that *resolves* to a private address
 * (DNS-rebinding) cannot be pre-checked here. Callers that fetch
 * user-supplied URLs should therefore ALSO constrain destinations with an
 * exact-host allowlist (see `resolve-url`) — these checks are defense in
 * depth against literal-IP and obvious-internal-name targets, not a complete
 * SSRF solution on their own.
 */

function parseIPv4(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map((n) => Number(n));
  if (octets.some((o) => o < 0 || o > 255)) return null;
  return octets;
}

function isBlockedIPv4(host: string): boolean {
  const o = parseIPv4(host);
  if (!o) return false;
  const [a, b] = o;
  if (a === 0) return true; // 0.0.0.0/8 (incl. unspecified)
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local (incl. 169.254.169.254 metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

function isBlockedIPv6(rawHost: string): boolean {
  // URL.hostname wraps IPv6 in brackets — strip them.
  let h = rawHost.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (!h.includes(':')) return false; // not an IPv6 literal

  if (h === '::1' || h === '::') return true; // loopback / unspecified

  // IPv4-mapped/embedded (e.g. ::ffff:169.254.169.254) — check the tail v4.
  const v4Tail = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(h);
  if (v4Tail && isBlockedIPv4(v4Tail[1])) return true;

  const first = h.split(':')[0];
  if (first.startsWith('fc') || first.startsWith('fd')) return true; // ULA fc00::/7
  if (first === 'fe80' || first.startsWith('fe8') || first.startsWith('fe9') || first.startsWith('fea') || first.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  return false;
}

function isBlockedHostname(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, ''); // strip trailing dot
  if (h === '' || h === 'localhost') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (isBlockedIPv4(h)) return true;
  if (isBlockedIPv6(host)) return true;
  return false;
}

/**
 * Parse `raw` and reject anything that is not a plain, public http(s) URL:
 * non-http(s) schemes, embedded credentials, and loopback / private /
 * link-local / unspecified / CGNAT / multicast / obvious-internal targets.
 * Returns the parsed URL on success; throws `Error` on rejection.
 */
export function assertPublicHttpUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  if (url.username || url.password) {
    throw new Error('URLs with embedded credentials are not allowed');
  }
  if (isBlockedHostname(url.hostname)) {
    throw new Error('Destination host is not allowed');
  }
  return url;
}
