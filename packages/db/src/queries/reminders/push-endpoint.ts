import { lookup } from "node:dns/promises";
import {
  classifyPushEndpointUrl,
  isAllowlistedPushHost,
  isBlockedPushAddress,
  parsePushEndpointAllowlist,
} from "@tendnote/domain/push-endpoint";

/**
 * The resolving half of the push endpoint rule.
 *
 * `classifyPushEndpointUrl` can say that `https://169.254.169.254/x` is off
 * limits, but not that `https://push.attacker.example/x` is: only asking DNS
 * can. So this module resolves every A and AAAA record behind the host and
 * refuses if any one of them lands somewhere a request from inside our network
 * must not go. Every address matters, not the first: a name that answers with
 * one public address and one loopback address would otherwise be admitted and
 * then connected to at whichever the resolver felt like returning next.
 *
 * The decision is deliberately three-valued. "Blocked" is a fact about the
 * destination and is permanent; "unresolved" only says DNS could not answer,
 * which is a fact about the moment. Callers must treat them differently -
 * refusing a registration during a resolver blip would be wrong, and treating
 * an unresolvable name as safe to connect to would be worse.
 */

export type PushEndpointAddress = { address: string; family: 4 | 6 };

export type PushEndpointDecision =
  | { status: "allowed"; host: string; addresses: PushEndpointAddress[] }
  | { status: "blocked"; reason: string }
  | { status: "unresolved"; reason: string };

export type PushEndpointLookup = (hostname: string) => Promise<PushEndpointAddress[]>;

export type PushEndpointCheckOptions = {
  lookup?: PushEndpointLookup;
  /** `undefined` reads the environment; `null` means "no host restriction". */
  allowlist?: readonly string[] | null;
};

/** Bounds a resolver that is wedged rather than merely slow. */
const LOOKUP_TIMEOUT_MS = 2_000;

const resolveAddresses: PushEndpointLookup = async (hostname) => {
  const entries = await lookup(hostname, { all: true, verbatim: true });
  return entries.map((entry) => ({
    address: entry.address,
    family: entry.family === 6 ? (6 as const) : (4 as const),
  }));
};

function configuredAllowlist(options: PushEndpointCheckOptions | undefined) {
  if (options && "allowlist" in options) return options.allowlist ?? null;
  return parsePushEndpointAllowlist(process.env.WEB_PUSH_ENDPOINT_ALLOWLIST);
}

async function lookupWithinBudget(
  resolve: PushEndpointLookup,
  hostname: string,
): Promise<PushEndpointAddress[]> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      resolve(hostname),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Push endpoint lookup timed out.")),
          LOOKUP_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function checkPushEndpointDestination(
  endpoint: string,
  options?: PushEndpointCheckOptions,
): Promise<PushEndpointDecision> {
  const shape = classifyPushEndpointUrl(endpoint);
  if (shape.status === "blocked") return { status: "blocked", reason: shape.reason };
  const allowlist = configuredAllowlist(options);
  if (!isAllowlistedPushHost(shape.host, allowlist)) {
    return { status: "blocked", reason: "That push endpoint is not a configured push provider." };
  }
  let addresses: PushEndpointAddress[];
  try {
    addresses = await lookupWithinBudget(options?.lookup ?? resolveAddresses, shape.host);
  } catch (error) {
    return {
      status: "unresolved",
      reason: error instanceof Error ? error.message : "Push endpoint host did not resolve.",
    };
  }
  if (addresses.length === 0) {
    return { status: "unresolved", reason: "Push endpoint host did not resolve." };
  }
  const offLimits = addresses.find((entry) => isBlockedPushAddress(entry.address));
  if (offLimits) {
    return {
      status: "blocked",
      reason: "A push endpoint must not address a private or reserved network.",
    };
  }
  return { status: "allowed", host: shape.host, addresses };
}

/**
 * The one seam the reminder service and its dispatcher take this policy
 * through, so that a deployment or a suite substitutes one thing rather than
 * one per call site.
 */
export type PushEndpointCheck = (endpoint: string) => Promise<PushEndpointDecision>;
