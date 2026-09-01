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

/** A single IPv4 CIDR block, kept as an unsigned base address plus prefix length. */
type Ipv4Cidr = { readonly base: number; readonly prefix: number };

/** Packs four octets into an unsigned 32-bit value for masked range compares. */
function ipv4ToUint32([a, b, c, d]: Ipv4Octets): number {
  return ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
}

function ipv4Cidr(a: number, b: number, c: number, d: number, prefix: number): Ipv4Cidr {
  return { base: ipv4ToUint32([a, b, c, d]), prefix };
}

/**
 * The IPv4 ranges a push endpoint must never address. Each entry reproduces one
 * of the checks the predicate used to spell out by hand, including the ones that
 * are deliberately broader than the matching RFC block: 192.0.0.0/16 (not just
 * TEST-NET-1's /24), 198.51.0.0/16 (not just TEST-NET-2's /24), 203.0.0.0/16
 * (not just TEST-NET-3's /24), and 224.0.0.0/3 for everything at or above 224.
 * Do not narrow these to the strict RFC prefixes: that would admit an address
 * the old code rejected and open a hole in the SSRF backstop.
 */
const IPV4_BLOCKED_RANGES: readonly Ipv4Cidr[] = [
  ipv4Cidr(0, 0, 0, 0, 8), // unspecified and "this network"
  ipv4Cidr(10, 0, 0, 0, 8), // RFC 1918
  ipv4Cidr(100, 64, 0, 0, 10), // carrier-grade NAT
  ipv4Cidr(127, 0, 0, 0, 8), // loopback
  ipv4Cidr(169, 254, 0, 0, 16), // link-local, including 169.254.169.254
  ipv4Cidr(172, 16, 0, 0, 12), // RFC 1918
  ipv4Cidr(192, 0, 0, 0, 16), // IETF protocol assignments and TEST-NET-1 (broad /16)
  ipv4Cidr(192, 168, 0, 0, 16), // RFC 1918
  ipv4Cidr(198, 18, 0, 0, 15), // benchmarking
  ipv4Cidr(198, 51, 0, 0, 16), // TEST-NET-2 (broad /16)
  ipv4Cidr(203, 0, 0, 0, 16), // TEST-NET-3 (broad /16)
  ipv4Cidr(224, 0, 0, 0, 3), // multicast, reserved, and 255.255.255.255
];

function matchesIpv4Cidr(value: number, { base, prefix }: Ipv4Cidr): boolean {
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (value & mask) >>> 0 === (base & mask) >>> 0;
}

function isBlockedIpv4(octets: Ipv4Octets): boolean {
  const value = ipv4ToUint32(octets);
  return IPV4_BLOCKED_RANGES.some((range) => matchesIpv4Cidr(value, range));
}

function embeddedIpv4(high: number, low: number): Ipv4Octets {
  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

/**
 * The IPv6 forms that carry an IPv4 destination inside them, judged by the IPv4
 * rules on the address they embed: ::ffff:a.b.c.d (mapped), ::a.b.c.d
 * (compatible), the NAT64 well-known prefix, and 6to4. Returns `null` when the
 * address is none of these, so the caller falls through to the prefix ranges.
 * The all-zero address :: is not embedded IPv4 (nothing to embed); it falls
 * through and is caught by ::/16 below, exactly as before.
 */
function embeddedIpv4Verdict(groups: Ipv6Groups): boolean | null {
  const leadingZeros = groups.findIndex((group) => group !== 0);
  if (leadingZeros >= 5 && (groups[5] === 0xffff || groups[5] === 0)) {
    return isBlockedIpv4(embeddedIpv4(groups[6], groups[7]));
  }
  if (groups[0] === 0x0064 && groups[1] === 0xff9b) {
    return isBlockedIpv4(embeddedIpv4(groups[6], groups[7])); // NAT64 well-known prefix
  }
  if (groups[0] === 0x2002) return isBlockedIpv4(embeddedIpv4(groups[1], groups[2])); // 6to4
  return null;
}

/** An IPv6 prefix, as its fixed leading 16-bit groups plus the prefix length. */
type Ipv6Prefix = { readonly base: readonly number[]; readonly prefix: number };

/**
 * The pure-prefix IPv6 ranges (no embedded IPv4) a push endpoint must never
 * address. ::/16 covers both the unallocated remainder of that block and the
 * unspecified address ::.
 */
const IPV6_BLOCKED_PREFIXES: readonly Ipv6Prefix[] = [
  { base: [0x0000], prefix: 16 }, // ::/16 unallocated remainder, and :: itself
  { base: [0xfc00], prefix: 7 }, // fc00::/7 unique local, including fd00:ec2::254
  { base: [0xfe80], prefix: 10 }, // fe80::/10 link-local
  { base: [0xff00], prefix: 8 }, // ff00::/8 multicast
  { base: [0x0100, 0x0000, 0x0000, 0x0000], prefix: 64 }, // 100::/64 discard-only
  { base: [0x2001, 0x0000], prefix: 23 }, // 2001::/23 IETF protocol assignments
  { base: [0x2001, 0x0db8], prefix: 32 }, // 2001:db8::/32 documentation
];

function matchesIpv6Prefix(groups: Ipv6Groups, { base, prefix }: Ipv6Prefix): boolean {
  let remaining = prefix;
  for (let index = 0; index < base.length && remaining > 0; index += 1) {
    const bits = Math.min(16, remaining);
    const mask = bits === 16 ? 0xffff : (0xffff << (16 - bits)) & 0xffff;
    const group = groups[index] ?? 0;
    const groupBase = base[index] ?? 0;
    if (((group ^ groupBase) & mask) !== 0) return false;
    remaining -= bits;
  }
  return true;
}

function isBlockedIpv6(groups: Ipv6Groups): boolean {
  const embedded = embeddedIpv4Verdict(groups);
  if (embedded !== null) return embedded;
  return IPV6_BLOCKED_PREFIXES.some((entry) => matchesIpv6Prefix(groups, entry));
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
