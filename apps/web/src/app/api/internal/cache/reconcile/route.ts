import { createHmac, timingSafeEqual } from "node:crypto";
import { affectedScopeSchema } from "@tendnote/db/queries/general-actions";
import { z } from "zod";
import { reconcileAffectedScopes } from "@/lib/cache/reconcile-affected-scopes";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

const payloadSchema = z.object({ scopes: z.array(affectedScopeSchema).max(200) }).strict();

export async function POST(request: Request) {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) return Response.json({ error: "Reconciliation is unavailable." }, { status: 503 });

  const timestamp = request.headers.get("x-tendnote-reconcile-timestamp");
  const providedSignature = request.headers.get("x-tendnote-reconcile-signature");
  const parsedTimestamp = timestamp ? Number(timestamp) : Number.NaN;
  if (
    !timestamp ||
    !providedSignature ||
    !Number.isFinite(parsedTimestamp) ||
    Math.abs(Date.now() - parsedTimestamp) > MAX_CLOCK_SKEW_MS
  ) {
    return Response.json({ error: "Invalid reconciliation signature." }, { status: 401 });
  }

  const body = await request.text();
  const expectedSignature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");
  if (!signaturesMatch(providedSignature, expectedSignature)) {
    return Response.json({ error: "Invalid reconciliation signature." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return Response.json({ error: "Invalid affected scopes." }, { status: 400 });
  }
  const parsed = payloadSchema.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: "Invalid affected scopes." }, { status: 400 });
  }
  reconcileAffectedScopes(parsed.data.scopes, { origin: "background" });
  return new Response(null, { status: 204 });
}

function signaturesMatch(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided, "hex");
  const expectedBytes = Buffer.from(expected, "hex");
  return (
    providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes)
  );
}
