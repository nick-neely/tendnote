import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";
import { toolOutputs, without } from "../expectations";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The in-between `propose_suggested_memory` was built to be.
 *
 * Eve had `capture_memory` for "remember this" and nothing for a fact that
 * merely came up - so a fact worth keeping either became an approved memory it
 * was not entitled to write, or evaporated. This turn is the shape that gap had:
 * the user logs a note and mentions something in passing, without ever saying
 * remember.
 *
 * Both halves are gates. The proposal must be grounded in a source record that
 * exists (the tool takes a `sourceRecordId`, so the note has to be logged first),
 * and the answer must not describe a review card as a saved fact - the failure
 * the tool's whole output projection is shaped to prevent.
 */
export default defineEval({
  description:
    "A fact that merely came up is proposed for review against a logged note, never saved as an approved memory.",
  tags: ["deterministic", "behavior", "memory", "review-gate"],
  async test(t) {
    await t.send(
      "Log a note about my call with Priya Shah: we went through the launch checklist. She also mentioned her sister is moving to Denver in August.",
    );

    t.succeeded();
    t.calledTool("search_people", { input: { query: /Priya/i }, count: 1 });
    // The note is the grounding, and it has to exist before the proposal can reference it.
    t.calledTool("capture_source_record", {
      input: { personId: UUID, retainedContent: /launch checklist|Denver|sister/i },
      count: 1,
    });
    t.calledTool("propose_suggested_memory", {
      input: { personId: UUID, sourceRecordId: UUID, content: /Denver|sister/i },
      count: 1,
    });
    t.toolOrder(["search_people", "capture_source_record", "propose_suggested_memory"]);
    // The owning tool result is the proof that Eve did not merely promise a card: its
    // suggested memory is grounded in the exact source record and the person that the
    // preceding calls resolved. The persisted status is still tentative.
    t.eventsSatisfy("the Suggested Memory proposal is grounded and reviewable", (events) => {
      const search = toolOutputs(events, "search_people").find(isRecord);
      const capture = toolOutputs(events, "capture_source_record").find(isRecord);
      const proposal = toolOutputs(events, "propose_suggested_memory").find(isRecord);
      if (!search || !capture || !proposal) return false;

      const people = search.people;
      const resolvedPersonId =
        Array.isArray(people) && people.length === 1 && isRecord(people[0])
          ? nestedString(people[0], "id")
          : null;

      const capturedSourceId = nestedString(capture, "sourceRecord", "id");
      const capturedPersonId = nestedString(capture, "linkedPersonId");
      const proposalSourceId = nestedString(proposal, "sourceRecord", "id");
      const memorySourceId = nestedString(proposal, "memory", "sourceRecordId");
      const proposedPersonId = nestedString(proposal, "memory", "personId");
      const status = nestedString(proposal, "memory", "status");
      const componentType = nestedString(proposal, "component", "type");

      return (
        search.requiresDisambiguation === false &&
        resolvedPersonId !== null &&
        capturedSourceId !== null &&
        capturedSourceId === proposalSourceId &&
        proposalSourceId === memorySourceId &&
        capturedPersonId !== null &&
        capturedPersonId === resolvedPersonId &&
        proposedPersonId === resolvedPersonId &&
        status === "suggested" &&
        componentType === "suggested_memory_review"
      );
    });
    // "Remember" was never said, so nothing durable may be written.
    t.notCalledTool("capture_memory");
    t.notCalledTool("approve_suggested_memory");
    // And the review card is not reported as a saved fact.
    t.check(
      t.reply,
      includes(
        without(
          "I(’|')?ve (saved|logged|noted|remembered) that (her|Priya(’|')?s) sister|I(’|')?ll remember (that|her sister)|saved (it )?as a memory",
        ),
      ),
    );
    t.check(t.reply, includes(/review|approve|suggestion|waiting/i));
  },
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function nestedString(value: Record<string, unknown>, ...path: string[]): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === "string" ? current : null;
}
