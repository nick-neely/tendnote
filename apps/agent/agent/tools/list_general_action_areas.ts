import { listGeneralActionAreas } from "@tendnote/db/queries/general-action-areas";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * How many Areas one ask returns.
 *
 * Areas are flat and few by design (ADR 0146) — a handful of seeded defaults plus
 * whatever the user added — so this is a ceiling on a pathological account rather
 * than a paging story. It is a default the model can raise, not a hidden cap, and
 * the result says when it truncated so a missing Area is never silent.
 */
const DEFAULT_AREA_LIST_LIMIT = 25;

const inputSchema = z.object({
  includeArchived: z
    .boolean()
    .default(false)
    .describe(
      "Include Areas the user archived. Defaults to false. An archived Area cannot be filed into — read it only to explain where an existing action already sits.",
    ),
  limit: z
    .number()
    .int()
    .min(1)
    .max(50)
    .default(DEFAULT_AREA_LIST_LIMIT)
    .describe(
      `Max Areas to return, in the user's own order. Defaults to ${DEFAULT_AREA_LIST_LIMIT}.`,
    ),
});

/**
 * What to tell the model when nothing came back. It has to be true of both empty
 * cases — a user who has never opened Actions, and one who archived every Area —
 * because the tool cannot tell them apart and a guess here becomes a false sentence
 * to the user.
 */
const NO_AREAS_GUIDANCE =
  "There are no Areas to file into. Areas are seeded the first time the user opens Actions " +
  "in the app, and are archived from there too. MANDATORY NEXT TOOL CALL for an explicit " +
  "request to add an Action: call `create_general_action` immediately in this same turn " +
  "with `areaId` omitted so it is created unfiled. The original add request is already " +
  "confirmation. Do not reply before the create call, ask whether to add it unfiled, " +
  "suggest setting up Areas first, or defer the Action. Never invent an Area or offer to " +
  "create one: Eve cannot create, rename, or archive Areas.";

/** What to tell the model when it now holds real Area handles. */
const AREA_GUIDANCE =
  "`areaId` is the handle `create_general_action`, `edit_general_action`, " +
  "`suggest_general_action`, and `plan_suggested_general_actions` accept — copy one from " +
  "this list exactly and never guess or retype one. Name the Area to the user by its name; " +
  "never write an id in your reply. File an action under an Area only when the user asked " +
  "for it or their own words name one, and omit `areaId` to leave it unfiled. An archived " +
  "Area cannot be filed into, and a whole-household action always stays unfiled because " +
  "Areas are one member's personal filing.";

/**
 * The owner's General Action Areas, which is the one thing that made `areaId`
 * fillable at all.
 *
 * Four tools have accepted an `areaId` since Phase 5 and a skill told the model to
 * use it, but nothing could list Areas — so the only way to produce one was to
 * invent a uuid, and an invented uuid is a rejected write. This read closes that
 * loop: it is the sole source of a real Area handle in Eve's context.
 *
 * Read-only on purpose. Creating, renaming, and archiving Areas stay in the app,
 * where the name-uniqueness rules and the archive/restore recovery path are
 * presented to the user (ADR 0146); Eve files into what exists and nothing more.
 */
export default defineTool({
  description:
    "List the user's General Action Areas — the flat life categories (Home, Work, Health, …) that Actions can be filed under. Use this BEFORE filing an Action under an Area: it is the only source of a real `areaId` for create_general_action, edit_general_action, suggest_general_action, and plan_suggested_general_actions. Also use it to answer 'what areas do I have?' or 'what can I file this under?'. Returns each Area's name, its handle, and whether it is archived; active Areas only unless you ask for archived ones. Do NOT use this to list the actions themselves (`list_general_actions`), and do NOT call it when the user did not ask to file anything and named no category — an unfiled action is a perfectly normal action. Eve cannot create, rename, or archive an Area; if the user wants a new one, say it is made in the Actions surface of the app.",
  inputSchema,
  async execute(input, ctx) {
    const ownerUserId = resolveOwnerUserId(ctx);

    const areas = await withModelSafeStoreErrors(() =>
      listGeneralActionAreas({ ownerUserId, includeArchived: input.includeArchived }),
    );
    // The shared list applies no limit of its own, so the bound is applied here
    // rather than left to the model's context window.
    const shown = areas.slice(0, input.limit);

    return {
      count: shown.length,
      truncated: shown.length < areas.length,
      areas: shown.map((area) => ({
        id: area.id,
        name: area.name,
        archived: area.archivedAt !== null,
      })),
    };
  },
  /**
   * The Area id travels, deliberately.
   *
   * It is the same call `search_assets` documents: a projection that hid the id
   * would not hide it from the user, it would make the model invent one, and every
   * tool that takes an `areaId` would then fail. The reply-side rule ("never show
   * raw record ids") is enforced where it belongs, in the always-on instructions.
   */
  toModelOutput(output) {
    return {
      type: "json" as const,
      value: {
        count: output.count,
        truncated: output.truncated,
        areas: output.areas.map((area) => ({
          areaId: area.id,
          name: area.name,
          archived: area.archived,
        })),
        guidance: output.count === 0 ? NO_AREAS_GUIDANCE : AREA_GUIDANCE,
      },
    };
  },
});
