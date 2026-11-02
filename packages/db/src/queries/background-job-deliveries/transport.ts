import type { BackgroundJobQueueSendAdapter } from "./queue-publish";

/**
 * The queue transport this runtime registered, for shared code that must
 * publish from deep inside a mutation it does not own the edge of.
 *
 * Reminder scheduling runs inside general action, follow-up, Saved Item and
 * capture mutations that both the web app and Eve call, so no single caller
 * could hand it a transport. Each runtime instead registers its own signed
 * adapter once at startup (ADR 0068 keeps `@vercel/queue` out of this
 * package). Kept on `globalThis` because Next.js may load instrumentation and
 * route code as separate module instances in one process.
 *
 * Unregistered - tests, scripts, a runtime that never opted in - means nothing
 * publishes ahead and the recovery cron delivers, exactly as before.
 */
const TRANSPORT_KEY = Symbol.for("tendnote.background-job-queue.transport");

type TransportHolder = { [TRANSPORT_KEY]?: BackgroundJobQueueSendAdapter };

export function registerBackgroundJobQueueTransport(
  transport: BackgroundJobQueueSendAdapter | undefined,
): void {
  (globalThis as TransportHolder)[TRANSPORT_KEY] = transport;
}

export function registeredBackgroundJobQueueTransport(): BackgroundJobQueueSendAdapter | undefined {
  return (globalThis as TransportHolder)[TRANSPORT_KEY];
}
