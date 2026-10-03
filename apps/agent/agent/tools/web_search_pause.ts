import { defineDynamic } from "eve/tools";
import { webSearchPause } from "../lib/web-search-pause";

/**
 * Web search's Account Ceiling (spec #591): at the ceiling, `web_search` is
 * withheld until the Usage Period resets. The rule and its failure direction
 * live in `lib/web-search-pause.ts`; this file only applies them per turn.
 */
export default defineDynamic({
  events: {
    "turn.started": (_event, ctx) =>
      webSearchPause(ctx.session?.auth?.current?.principalId?.trim() || null),
  },
});
