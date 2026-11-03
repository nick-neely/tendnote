import type { Instrumentation } from "next";

/** One server-only startup record per runtime, including cron and billing functions. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { logNodeRuntimeVersion } = await import("@/lib/diagnostics/node-runtime-version");
    logNodeRuntimeVersion();
  } catch {
    // Temporary diagnostics must not block startup if their module cannot load.
  }
  await registerReminderWakeupTransport();
}

/**
 * Lets reminder mutations publish their wake-up as soon as they commit, delayed
 * to the alert time (ADR 0267). Reminder scheduling runs deep inside shared
 * mutations, so it reaches the transport through this registration rather than
 * a parameter. Without it reminders still arrive, only through the recovery
 * cron, so a failure here is reported and startup continues.
 */
async function registerReminderWakeupTransport() {
  try {
    const [{ registerBackgroundJobQueueTransport }, { createVercelBackgroundJobQueueAdapter }] =
      await Promise.all([
        import("@tendnote/db/queries/background-job-deliveries"),
        import("@/lib/background-jobs/vercel-queue-transport"),
      ]);
    registerBackgroundJobQueueTransport(createVercelBackgroundJobQueueAdapter());
  } catch {
    console.error("runtime.queue_transport_unavailable", { service: "web" });
  }
}

/**
 * Server errors Next catches go to GlitchTip through the one allowed
 * diagnostic envelope (#641), when this deployment and the request are
 * eligible. The reporter loads only on the Node.js runtime and only once an
 * error happens, and it hands its work off rather than holding up the error
 * response.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("@/lib/diagnostics/report");
  reportServerError(error, request, context);
};
