import "server-only";

import { allowsErrorReports } from "@tendnote/db/queries/account-telemetry";
import { isTelemetryEligibleCountry } from "@tendnote/domain/account-funnel";
import { type AdmissionEnvironment, parseAdmissionPolicy } from "@tendnote/domain/admission";
import { waitUntil } from "@vercel/functions";
import { requestCountry } from "@/lib/access/region-block";
import { getProductRateLimiter } from "@/lib/rate-limit";
import { type DiagnosticEnvelope, type ServerRouteContext, serverEnvelope } from "./envelope";
import {
  diagnosticRelease,
  type GlitchTipTarget,
  glitchTipEvent,
  glitchTipTarget,
  sendToGlitchTip,
} from "./glitchtip";

/*
 * Error reporting is optional telemetry, so it is collected only in hosted
 * mode, only once a GlitchTip DSN is configured, only for a request Vercel's
 * edge places in the US, and only for an account that has not switched
 * telemetry off or asked to be deleted. A request with no session is
 * anonymous: there is no opt-out to honour and nothing to link. Eligibility is
 * checked at capture and again just before forwarding, so an opt-out or
 * deletion in between still stops the report. If eligibility cannot be
 * established, because the session or the setting cannot be read, the report
 * is dropped.
 *
 * Nothing here throws, and a report never holds up the request it describes:
 * the slow part runs after the response.
 */

export type DiagnosticsEnvironment = AdmissionEnvironment & {
  GLITCHTIP_DSN?: string;
  VERCEL_GIT_COMMIT_SHA?: string;
};

export type DiagnosticDependencies = {
  env?: DiagnosticsEnvironment;
  /** The signed-in account behind these headers, or `null` when there is none. */
  sessionUserId?: (headers: Headers) => Promise<string | null>;
  allowsErrorReports?: (input: { userId: string }) => Promise<boolean>;
  /** Whether this account may send another browser report now. */
  withinReportBudget?: (userId: string) => Promise<boolean>;
  /** Keep work alive past the response without awaiting it; Vercel's `waitUntil` outside tests. */
  waitUntil?: (task: Promise<void>) => void;
  fetch?: typeof fetch;
};

/** A report that passed capture: where it goes, and whose opt-out to re-check before it does. */
export type DiagnosticCapture = {
  target: GlitchTipTarget;
  release: string;
  userId: string | null;
};

async function defaultSessionUserId(headers: Headers): Promise<string | null> {
  const { getAuth } = await import("@/lib/auth/server");
  const session = await getAuth().api.getSession({ headers });
  return session?.user.id ?? null;
}

async function defaultWithinReportBudget(userId: string): Promise<boolean> {
  const result = await getProductRateLimiter().check({
    subject: userId,
    costCategory: "diagnostic-report",
  });
  return result.allowed;
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.name : "unknown";
}

/**
 * Decide at capture whether a report may be collected. `requireAccount` is set
 * for browser reports, which arrive at a public endpoint: a signed-in session
 * and a per-account budget bound who can make Tendnote forward anything, and
 * how much.
 */
export async function captureDiagnostic(
  headers: Headers,
  options: { requireAccount: boolean },
  dependencies: DiagnosticDependencies = {},
): Promise<DiagnosticCapture | null> {
  try {
    const env = dependencies.env ?? process.env;
    if (parseAdmissionPolicy(env).mode !== "hosted") return null;
    const target = glitchTipTarget(env.GLITCHTIP_DSN);
    if (!target) return null;
    if (!isTelemetryEligibleCountry(requestCountry(headers))) return null;

    const userId = await (dependencies.sessionUserId ?? defaultSessionUserId)(headers);
    if (options.requireAccount) {
      if (userId === null) return null;
      const withinBudget = dependencies.withinReportBudget ?? defaultWithinReportBudget;
      if (!(await withinBudget(userId))) return null;
    }
    const allows = dependencies.allowsErrorReports ?? allowsErrorReports;
    if (userId !== null && !(await allows({ userId }))) return null;

    return { target, release: diagnosticRelease(env.VERCEL_GIT_COMMIT_SHA), userId };
  } catch (error) {
    console.warn("diagnostics: could not establish eligibility", { reason: failureReason(error) });
    return null;
  }
}

/** Re-check the account, then send the envelope and nothing else. */
export async function forwardDiagnostic(
  capture: DiagnosticCapture,
  envelope: DiagnosticEnvelope,
  dependencies: DiagnosticDependencies = {},
): Promise<void> {
  try {
    const allows = dependencies.allowsErrorReports ?? allowsErrorReports;
    if (capture.userId !== null && !(await allows({ userId: capture.userId }))) return;
    await sendToGlitchTip(
      capture.target,
      glitchTipEvent(envelope, capture.release),
      dependencies.fetch ?? fetch,
    );
  } catch (error) {
    console.warn("diagnostics: could not forward a report", { reason: failureReason(error) });
  }
}

/** The request fields `onRequestError` hands over. Only two headers are ever read. */
type ErroredRequest = { headers: Record<string, string | string[] | undefined> };

function header(request: ErroredRequest, name: string): string | null {
  const value = request.headers[name];
  return Array.isArray(value) ? value.join(", ") : (value ?? null);
}

/**
 * Report a server error that Next caught. The envelope is built at once, from
 * the error's kind and stack and the route's pattern; the capture later sees
 * only the session cookie and the edge's country, copied into a fresh header
 * set. Neither sees the request's path, method, or any other header.
 *
 * Next awaits `onRequestError` before it sends the error response, and `after`
 * has no request scope there, so the report is started and handed to the
 * platform's `waitUntil` instead of awaited. On Vercel that keeps the function
 * alive until it finishes; a long-running server simply lets it finish.
 */
export function reportServerError(
  error: unknown,
  request: ErroredRequest,
  context: ServerRouteContext,
  dependencies: DiagnosticDependencies = {},
): void {
  try {
    const envelope = serverEnvelope(error, context, process.versions.node);
    const headers = new Headers();
    const cookie = header(request, "cookie");
    const country = header(request, "x-vercel-ip-country");
    if (cookie !== null) headers.set("cookie", cookie);
    if (country !== null) headers.set("x-vercel-ip-country", country);

    const report = async () => {
      const capture = await captureDiagnostic(headers, { requireAccount: false }, dependencies);
      if (capture) await forwardDiagnostic(capture, envelope, dependencies);
    };
    (dependencies.waitUntil ?? waitUntil)(report());
  } catch (reportError) {
    console.warn("diagnostics: could not report a server error", {
      reason: failureReason(reportError),
    });
  }
}
