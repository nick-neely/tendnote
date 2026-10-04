import { after } from "next/server";
import { parseBrowserDiagnostic } from "@/lib/diagnostics/browser-report";
import { browserEnvelope } from "@/lib/diagnostics/envelope";
import { captureDiagnostic, forwardDiagnostic } from "@/lib/diagnostics/report";

/** A sanitized report is a few kilobytes; anything far larger is not one. */
const MAX_BODY_CHARS = 16_384;

function parse(body: string) {
  if (body.length > MAX_BODY_CHARS) return null;
  try {
    return parseBrowserDiagnostic(JSON.parse(body));
  } catch {
    return null;
  }
}

/**
 * Where the browser hands over a sanitized error report (#641). The report is
 * validated again here and rebuilt from its allowlisted fields; the request's
 * headers, cookie, URL, address, and user-agent string are read only to decide
 * eligibility and are never copied into what is forwarded. Forwarding runs
 * after the response, behind a second eligibility check.
 *
 * Always 204, reported or not, so the answer says nothing about the decision
 * and the page has nothing to wait on.
 */
export async function POST(request: Request) {
  // A declared length over the cap is refused before the body is read.
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_CHARS) {
    return new Response(null, { status: 204 });
  }
  const report = parse(await request.text());
  if (report) {
    const capture = await captureDiagnostic(request.headers, { requireAccount: true });
    if (capture) after(() => forwardDiagnostic(capture, browserEnvelope(report)));
  }
  return new Response(null, { status: 204 });
}
