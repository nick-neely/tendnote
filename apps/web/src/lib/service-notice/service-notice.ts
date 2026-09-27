import { z } from "zod";

/**
 * The Service Notice the operator posts to the status page (`status/notice.json`,
 * published by the status-page workflow). The product reads the published copy
 * rather than its own, so one file drives both surfaces and a notice reaches the
 * banner without a product deploy.
 */
export type ServiceNotice = { message: string; updatedAt: string };

const publishedNoticeSchema = z.object({
  notice: z.object({ message: z.string().trim().min(1), updatedAt: z.iso.datetime() }).nullable(),
});

const FETCH_TIMEOUT_MS = 3_000;

/**
 * Fetch the published notice. Every failure (no status page configured, the
 * host unreachable, a malformed file) is simply no banner: the notice is
 * advisory and must never break the product it annotates.
 */
export async function fetchServiceNotice(
  statusPageUrl: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ServiceNotice | null> {
  const base = statusPageUrl?.trim();
  if (!base) return null;

  try {
    const response = await fetchImpl(
      new URL("notice.json", base.endsWith("/") ? base : `${base}/`),
      {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;
    const parsed = publishedNoticeSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.notice : null;
  } catch {
    return null;
  }
}
