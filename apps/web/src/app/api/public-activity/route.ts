import { recordPublicActivity } from "@tendnote/db/queries/public-activity";
import { isTelemetryEligibleCountry } from "@tendnote/domain/account-funnel";
import { parseAdmissionPolicy } from "@tendnote/domain/admission";
import { parsePublicActivity } from "@tendnote/domain/public-activity";
import { requestCountry } from "@/lib/access/region-block";

/**
 * The largest report the site sends is about 50 bytes, so anything past this
 * is not a report and is never read in full.
 */
const MAX_REPORT_BYTES = 256;

/**
 * The body as text, or null when there is no report to read: no body, one too
 * large to be a report, or one that fails mid-read. A declared oversized body
 * is refused unread; an undeclared one is read only until it passes the cap.
 * Every null ends in the same uniform answer as any other dropped report.
 */
async function readReport(request: Request): Promise<string | null> {
  if (Number(request.headers.get("content-length")) > MAX_REPORT_BYTES) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const body = new Uint8Array(MAX_REPORT_BYTES);
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return new TextDecoder().decode(body.subarray(0, size));
      if (size + value.byteLength > MAX_REPORT_BYTES) {
        void reader.cancel().catch(() => {});
        return null;
      }
      body.set(value, size);
      size += value.byteLength;
    }
  } catch {
    return null;
  }
}

/**
 * The anonymous public activity counter the marketing site reports to (#646).
 *
 * The site posts one fixed event and one fixed page name, cross-origin and
 * without credentials. Counting is optional telemetry, so it happens only in
 * hosted mode and only when Vercel's edge says the request came from the US;
 * an unknown or any other country is dropped before anything is written.
 * Nothing about the request is kept, not its address, headers, or a cookie:
 * only a daily total goes up by one.
 *
 * A body too large to be a report is dropped without being read in full.
 *
 * Always 204, counted or not, so the answer says nothing about the decision
 * and the site has nothing to wait on.
 */
export async function POST(request: Request) {
  const body = await readReport(request);
  const activity = body === null ? null : parsePublicActivity(body);
  if (
    activity &&
    parseAdmissionPolicy(process.env).mode === "hosted" &&
    isTelemetryEligibleCountry(requestCountry(request.headers))
  ) {
    await recordPublicActivity(activity);
  }
  return new Response(null, { status: 204 });
}
