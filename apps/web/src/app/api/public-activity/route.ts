import { recordPublicActivity } from "@tendnote/db/queries/public-activity";
import { isTelemetryEligibleCountry } from "@tendnote/domain/account-funnel";
import { parseAdmissionPolicy } from "@tendnote/domain/admission";
import { parsePublicActivity } from "@tendnote/domain/public-activity";
import { requestCountry } from "@/lib/access/region-block";

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
 * Always 204, counted or not, so the answer says nothing about the decision
 * and the site has nothing to wait on.
 */
export async function POST(request: Request) {
  const activity = parsePublicActivity(await request.text());
  if (
    activity &&
    parseAdmissionPolicy(process.env).mode === "hosted" &&
    isTelemetryEligibleCountry(requestCountry(request.headers))
  ) {
    await recordPublicActivity(activity);
  }
  return new Response(null, { status: 204 });
}
