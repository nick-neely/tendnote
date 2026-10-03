import { readUsageNotices } from "@tendnote/db/queries/usage-bounds";
import { recoveryText, type UsageNotice } from "@tendnote/domain/usage-bounds";
import { withheldTool } from "./withheld-tool";

type ReadWebSearchNotice = (userId: string) => Promise<UsageNotice>;

const readWebSearchNotice: ReadWebSearchNotice = async (userId) =>
  (await readUsageNotices({ userId })).webSearch;

function withheldWebSearch(reason: string) {
  return {
    web_search: withheldTool(`${reason} Calling it does nothing.`, {
      performed: false,
      tool: "web_search",
      message: `${reason} Nothing was searched. Tell the user, and answer from what Tendnote already holds instead of retrying.`,
    }),
  };
}

/**
 * Web search's Account Ceiling, applied when a turn starts: at the ceiling,
 * `web_search` is rebound to an inert definition that says it is paused and
 * until when, and `null` leaves it as it is. Searches are counted as they run,
 * so a turn already searching finishes and the next turn sees the pause.
 *
 * It sits beside the mode gate, never inside it: it can only take web search
 * away, and only for spend, so no mode is ever handed a tool it does not allow.
 * A read that fails withholds web search for the turn, as a failed read refuses
 * a turn at Eve's door, so a usage read that cannot be made never becomes
 * unbounded searching. Nothing here may throw: Eve skips a resolver that throws,
 * which would leave web search in place.
 */
export async function webSearchPause(
  principalId: string | null,
  read: ReadWebSearchNotice = readWebSearchNotice,
) {
  // A session with no principal is restricted by the mode gate, web search included.
  if (!principalId) return null;

  let notice: UsageNotice;
  try {
    notice = await read(principalId);
  } catch {
    console.warn("usage: could not read web-search usage, so web search is off this turn");
    return withheldWebSearch("Web search is unavailable right now.");
  }
  if (notice.state !== "paused") return null;
  return withheldWebSearch(
    `Web search is paused because this account has used this month's web searches. ${recoveryText(notice.recovery)}`,
  );
}
