import { Agent } from "node:https";
import type { LookupFunction } from "node:net";
import type { ReminderPushSender } from "@tendnote/db/queries/reminders";
import {
  checkPushEndpointDestination,
  type PushEndpointAddress,
  type PushEndpointLookup,
} from "@tendnote/db/queries/reminders/push-endpoint";
import webPush from "web-push";

/**
 * Socket inactivity timeout, in milliseconds - `web-push` passes this option
 * straight through to `https.request`, so it is not the seconds its name
 * suggests elsewhere. An endpoint that completes the handshake and then says
 * nothing must not be able to hold a queue worker open indefinitely.
 */
const PUSH_SOCKET_TIMEOUT_MS = 10_000;

type WebPushProvider = Pick<typeof webPush, "sendNotification" | "setVapidDetails">;

function notFound(message: string) {
  return Object.assign(new Error(message), { code: "ENOTFOUND" });
}

/**
 * Pins the connection to the addresses that passed the destination check.
 *
 * Re-validating and then letting the socket resolve the name again leaves the
 * rebinding window the check exists to close: the same hostname can answer with
 * a public address for our lookup and a loopback address for the connection a
 * moment later. Substituting the resolver instead of the hostname keeps SNI and
 * certificate verification pointed at the real name.
 */
function pinnedLookup(host: string, addresses: readonly PushEndpointAddress[]): LookupFunction {
  const entries = addresses.map((entry) => ({ address: entry.address, family: entry.family }));
  return (hostname, options, callback) => {
    if (hostname !== host) {
      callback(notFound(`Unexpected push host ${hostname}.`), "");
      return;
    }
    const requested = options.family === 4 || options.family === 6 ? options.family : null;
    const matching = requested ? entries.filter((entry) => entry.family === requested) : entries;
    const first = matching[0];
    if (!first) {
      callback(notFound(`No verified address for ${hostname}.`), "");
      return;
    }
    if (options.all) callback(null, matching);
    else callback(null, first.address, first.family);
  };
}

export function createWebPushSender(input: {
  provider?: WebPushProvider;
  publicKey: string;
  privateKey: string;
  subject: string;
  /** Resolver for the destination check; defaults to the system resolver. */
  lookup?: PushEndpointLookup;
}): ReminderPushSender {
  const provider = input.provider ?? webPush;
  provider.setVapidDetails(input.subject, input.publicKey, input.privateKey);
  return async ({ subscription, payload, ttlSeconds }) => {
    /**
     * The stored endpoint is untrusted input no matter how long it has been
     * stored, so the last word on where this POST may go is taken here, at the
     * only point that actually opens the socket. A destination that is off
     * limits is reported as terminal, which retires the installation the same
     * way a provider's 410 does; one we cannot resolve is transient.
     */
    const destination = await checkPushEndpointDestination(subscription.endpoint, {
      lookup: input.lookup,
    });
    if (destination.status === "blocked") return { status: "terminal" } as const;
    if (destination.status === "unresolved") {
      throw new Error("Web Push provider temporarily unavailable.");
    }
    const agent = new Agent({
      keepAlive: false,
      lookup: pinnedLookup(destination.host, destination.addresses),
    });
    try {
      const response = await provider.sendNotification(subscription, JSON.stringify(payload), {
        TTL: ttlSeconds,
        timeout: PUSH_SOCKET_TIMEOUT_MS,
        agent,
      });
      return { status: "accepted", providerId: response.headers?.location ?? null } as const;
    } catch (error) {
      const statusCode =
        typeof error === "object" && error && "statusCode" in error
          ? Number(error.statusCode)
          : null;
      if (statusCode === 404 || statusCode === 410) return { status: "terminal" } as const;
      throw new Error("Web Push provider temporarily unavailable.");
    } finally {
      agent.destroy();
    }
  };
}

export function getWebPushSender() {
  const publicKey = process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) {
    throw new Error("Web Push VAPID configuration is incomplete.");
  }
  return createWebPushSender({ publicKey, privateKey, subject });
}
