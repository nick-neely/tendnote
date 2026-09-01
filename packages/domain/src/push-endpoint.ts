/**
 * Destination rules for a Web Push subscription endpoint.
 *
 * A subscription endpoint is not ordinary user data: the browser hands us a URL
 * and the server later POSTs to it on its own initiative, from inside the
 * network, with no user in the loop. That makes every stored endpoint a
 * server-side request forgery sink, and it makes `z.url()` the wrong amount of
 * checking - a Server Action is directly callable, so the fact that a real
 * `PushManager` produced the value on some other request proves nothing about
 * this one.
 *
 * This module holds the half of the answer that needs no network: scheme, port,
 * userinfo, length, and the address ranges no push provider ever lives in. It
 * stays free of node builtins so the same rules can be spent in a Zod schema
 * that both the browser and the server parse. The resolving half - "what does
 * this hostname actually point at, right now" - lives beside the sender, which
 * is the only place that can ask and then act on the answer.
 */

/** Longer than any provider endpoint observed in the wild, short enough to bound storage. */
export const PUSH_ENDPOINT_MAX_LENGTH = 2048;

export type PushEndpointShape =
  | { status: "ok"; url: URL; host: string }
  | { status: "blocked"; reason: string };

function blocked(reason: string): PushEndpointShape {
  return { status: "blocked", reason };
}

/** Strips the brackets the URL parser keeps around an IPv6 literal host. */
function pushEndpointHost(url: URL): string {
  const hostname = url.hostname;
  return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

type Ipv4Octets = readonly [number, number, number, number];
type Ipv6Groups = readonly [number, number, number, number, number, number, number, number];

function parseIpv4(value: string): Ipv4Octets | null {
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const octets: number[] = [];
  for (const part of parts) {
    // Leading zeros are octal in some resolvers and decimal in others; a
    // canonical address never has them, so treat the ambiguous form as "not an
    // IPv4 literal" and let the resolving check answer for it instead.
    if (!/^(?:0|[1-9]\d{0,2})$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    octets.push(octet);
  }
  return octets as unknown as Ipv4Octets;
}

function parseIpv6(value: string): Ipv6Groups | null {
  if (!/^[0-9a-f:.]+$/i.test(value)) return null;
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const readGroups = (segment: string): number[] | null => {
    if (segment === "") return [];
    const parts = segment.split(":");
    const groups: number[] = [];
    for (const [index, part] of parts.entries()) {
      if (index === parts.length - 1 && part.includes(".")) {
        const octets = parseIpv4(part);
        if (!octets) return null;
        groups.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/i.test(part)) return null;
      groups.push(Number.parseInt(part, 16));
    }
    return groups;
  };
  const head = readGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? readGroups(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? (head as unknown as Ipv6Groups) : null;
  const filled = 8 - head.length - tail.length;
  if (filled < 1) return null;
  return [...head, ...Array.from({ length: filled }, () => 0), ...tail] as unknown as Ipv6Groups;
}

function isBlockedIpv4(octets: Ipv4Octets): boolean {
  const [first, second] = octets;
  if (first === 0) return true; // 0.0.0.0/8 - unspecified and "this network"
  if (first === 10) return true; // RFC 1918
  if (first === 127) return true; // loopback
  if (first === 100 && second >= 64 && second <= 127) return true; // carrier-grade NAT
  if (first === 169 && second === 254) return true; // link-local, including 169.254.169.254
  if (first === 172 && second >= 16 && second <= 31) return true; // RFC 1918
  if (first === 192 && second === 0) return true; // IETF protocol assignments and TEST-NET-1
  if (first === 192 && second === 168) return true; // RFC 1918
  if (first === 198 && (second === 18 || second === 19)) return true; // benchmarking
  if (first === 198 && second === 51) return true; // TEST-NET-2
  if (first === 203 && second === 0) return true; // TEST-NET-3
  if (first >= 224) return true; // multicast, reserved, and 255.255.255.255
  return false;
}

function embeddedIpv4(high: number, low: number): Ipv4Octets {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIpv6(groups: Ipv6Groups): boolean {
  const leadingZeros = groups.findIndex((group) => group !== 0);
  // ::ffff:a.b.c.d and ::a.b.c.d both reach IPv4 space; judge them as IPv4.
  if (leadingZeros === -1) return true; // ::
  if (leadingZeros >= 5) {
    if (groups[5] === 0xffff || groups[5] === 0) {
      return isBlockedIpv4(embeddedIpv4(groups[6], groups[7]));
    }
  }
  // NAT64 well-known prefix and 6to4 also carry an IPv4 destination inside.
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    return isBlockedIpv4(embeddedIpv4(groups[6], groups[7]));
  }
  if (groups[0] === 0x2002) return isBlockedIpv4(embeddedIpv4(groups[1], groups[2]));
  if (groups[0] === 0) return true; // the rest of ::/16 is unallocated
  if ((groups[0] & 0xfe00) === 0xfc00) return true; // fc00::/7, including fd00:ec2::254
  if ((groups[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((groups[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (groups[0] === 0x0100 && groups[1] === 0 && groups[2] === 0 && groups[3] === 0) return true;
  if (groups[0] === 0x2001 && groups[1] <= 0x01ff) return true; // IETF protocol assignments
  if (groups[0] === 0x2001 && groups[1] === 0x0db8) return true; // documentation
  return false;
}

/**
 * Whether an IP address literal belongs to a range no Web Push provider can be
 * reached at, and that a request originating inside our network must never be
 * pointed at. A hostname that is not an address literal answers `false` here -
 * only resolution can decide for it.
 */
export function isBlockedPushAddress(address: string): boolean {
  const ipv4 = parseIpv4(address);
  if (ipv4) return isBlockedIpv4(ipv4);
  const ipv6 = parseIpv6(address);
  if (ipv6) return isBlockedIpv6(ipv6);
  return false;
}

/**
 * The checks a stored endpoint must pass before anything resolves it: HTTPS
 * only, no credentials smuggled into the authority, the default port only, a
 * bounded length, and no address literal that is already known to be off
 * limits.
 */
export function classifyPushEndpointUrl(endpoint: string): PushEndpointShape {
  if (typeof endpoint !== "string" || endpoint.trim() === "") {
    return blocked("A push endpoint is required.");
  }
  if (endpoint.length > PUSH_ENDPOINT_MAX_LENGTH) {
    return blocked(`A push endpoint must be at most ${PUSH_ENDPOINT_MAX_LENGTH} characters.`);
  }
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return blocked("A push endpoint must be a valid URL.");
  }
  if (url.protocol !== "https:") return blocked("A push endpoint must use https.");
  if (url.username !== "" || url.password !== "") {
    return blocked("A push endpoint must not carry credentials.");
  }
  if (url.port !== "" && url.port !== "443") {
    return blocked("A push endpoint must use the default https port.");
  }
  const host = pushEndpointHost(url);
  if (host === "") return blocked("A push endpoint must name a host.");
  if (isBlockedPushAddress(host)) {
    return blocked("A push endpoint must not address a private or reserved network.");
  }
  return { status: "ok", url, host };
}

/** The predicate form, for schema refinement. */
export function isAcceptablePushEndpointShape(endpoint: string): boolean {
  return classifyPushEndpointUrl(endpoint).status === "ok";
}

/**
 * Parses the optional provider allowlist, e.g.
 * `fcm.googleapis.com,updates.push.services.mozilla.com,*.notify.windows.com`.
 *
 * Unset means "no host restriction", never "allow nothing" and never "skip the
 * range checks": deployments that have not enumerated their providers must
 * still get the reserved-range backstop, and an operator who mistypes the
 * variable must not silently lose push instead of noticing.
 */
export function parsePushEndpointAllowlist(value: string | null | undefined): string[] | null {
  if (!value) return null;
  const hosts = value
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== "");
  return hosts.length > 0 ? hosts : null;
}

export function isAllowlistedPushHost(host: string, allowlist: readonly string[] | null): boolean {
  if (!allowlist || allowlist.length === 0) return true;
  const candidate = host.toLowerCase();
  return allowlist.some((pattern) =>
    pattern.startsWith("*.")
      ? candidate.length > pattern.length - 1 && candidate.endsWith(pattern.slice(1))
      : candidate === pattern,
  );
}
