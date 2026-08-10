import { getHouseholdCheckin } from "@tendnote/db/queries/household-home";
import { getOwnerTodayContext } from "@tendnote/db/queries/today";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { resolveOwnerUserId } from "../lib/owner";
import { withModelSafeStoreErrors } from "../lib/store-errors";

/**
 * The deliberate Household context, as one bounded read.
 *
 * Eve is private by default and stays that way: "we", a household's name, and
 * another member's name change nothing. This tool is the explicit door, and it
 * opens onto exactly the same composition the member's own Check-in shows —
 * membership re-read now, every candidate proved on its own facts, capped at
 * three before any model sees it. Eligibility and caps live outside the prompt on
 * purpose; the model may summarize or connect the set it is handed and may not
 * widen, rank, or reach past it (ADR 0220).
 *
 * There is no household argument, no member argument, and no scope argument. The
 * caller's own active membership is both the lookup key and the standing, so no
 * instruction, no prior turn, and no remembered household id can point this at a
 * workspace the caller is not currently in — and a member who has left gets the
 * same empty answer as someone who was never in one.
 */
export default defineTool({
  description:
    "Read the small set of shared household records the caller is currently coordinating — the same one to three timely records their own Household check-in shows. Use this only when the user deliberately asks about the household ('what are we coordinating?', 'anything shared coming up?', 'household check-in'). Do NOT use it because they said 'we', named a housemate, or mentioned something domestic: ordinary questions stay private. Returns canonical records with their type, whose they are, and their timing; report them as they are, name the household by its name, and never say a member owes work, failed to act, or is next in a turn. If nothing comes back, the household has nothing timely — do not speculate about what else might exist.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    const callerUserId = resolveOwnerUserId(ctx);

    const view = await withModelSafeStoreErrors(async () => {
      // The member's own local day, because "timely" is a question about their
      // calendar and not the server's.
      const { localDate, timeZone, now } = await getOwnerTodayContext({
        ownerUserId: callerUserId,
      });
      return getHouseholdCheckin({ callerUserId, localDate, timeZone, now });
    });

    return {
      household: view.household ? { name: view.household.name } : null,
      optedIn: view.optedIn,
      count: view.records.length,
      records: view.records.map((entry) => ({
        recordKind: entry.record.kind,
        recordId: entry.record.id,
        family: entry.family,
        href: entry.record.href,
        title: entry.title,
        context: entry.context,
        timing: entry.timing.explanation,
        // "Household" or "Shared by Mara": whose the record is, never who is
        // expected to do it.
        scopeLabel: entry.scopeLabel,
        // The record's own explicitly named field, or null — which is the
        // ordinary, calm case. Never inferred, and never a turn.
        responsibility: entry.responsibility,
      })),
      limitations: view.limitations,
      component: { type: "household_check_in", resultCount: view.records.length },
    };
  },
  /**
   * The model gets the records and the household's name, and no ids.
   *
   * Nothing here is a handle for a follow-up call: every action on a household
   * record opens its own canonical surface, so an id in Eve's context would buy
   * nothing and could only end up in a reply. The guidance carries the two things
   * a model reliably gets wrong about shared work — that a Responsibility Holder
   * is not an assignment, and that an empty read is not a hint.
   */
  toModelOutput(output) {
    return {
      type: "json",
      value: {
        household: output.household?.name ?? null,
        optedIn: output.optedIn,
        count: output.count,
        records: output.records.map((entry) => ({
          title: entry.title,
          what: entry.context,
          when: entry.timing,
          whose: entry.scopeLabel,
          lookingAfterIt: entry.responsibility,
        })),
        limitations: output.limitations,
        guidance:
          "Canonical household records, already filtered to what this member may see " +
          "and capped. Summarize them; do not rank them, add to them, or infer work " +
          "from them. `lookingAfterIt` is a stated fact about who is looking after a " +
          "record — never an assignment, a turn, or a reason to say someone is behind. " +
          "An empty list means nothing is timely, not that something is hidden.",
      },
    };
  },
});
