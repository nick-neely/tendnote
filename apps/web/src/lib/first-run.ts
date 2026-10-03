import { getHomeFirstRun, type HomeFirstRun, NOTHING_OWED } from "@tendnote/db/queries/first-run";
import { cache } from "react";
import { FIRST_RUN_SKIPPED_VALUE, type FirstRunPrompt } from "@/lib/first-run-copy";

/**
 * One read per request, shared by every Home region that streams on its own.
 * A failed read owes nothing: a missing prompt costs a newcomer one sentence,
 * a broken Home costs them the product.
 */
export const readHomeFirstRun = cache(async (ownerUserId: string): Promise<HomeFirstRun> => {
  try {
    return await getHomeFirstRun({ userId: ownerUserId });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("Unable to read the first run.", error);
    }
    return NOTHING_OWED;
  }
});

/**
 * The welcome while it is owed; the repeat only on the render a skip landed on,
 * and only while nobody is saved yet. The repeat needs no stored state: leaving
 * that URL is what spends it.
 */
export async function homeFirstRunPrompt(
  ownerUserId: string,
  skippedMarker: string | undefined,
): Promise<FirstRunPrompt> {
  const owed = await readHomeFirstRun(ownerUserId);
  if (owed.welcome) return "welcome";
  return skippedMarker === FIRST_RUN_SKIPPED_VALUE && owed.notebookEmpty ? "repeat" : null;
}
