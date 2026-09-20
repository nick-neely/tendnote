import { captureExplicitOutcome } from "@tendnote/db/queries/conversational-capture";
import { enqueueAndTriggerExtractionJob } from "@tendnote/db/queries/extraction-jobs";
import { captureSourceRecordForPerson } from "@tendnote/db/queries/source-records";
import { ownerUserId, type seedMonth } from "./fixtures";
import { assertTurnOutcomes, personOutcomes } from "./outcomes";
import { type PlannedTurn, plannedTurn } from "./workload";

// Called only by --smoke inside its local, simulated Gateway boundary. Exercise
// the actual DB-backed Capture entry point with the same prompts as paid replay.
export async function capturePreflight(persons: Awaited<ReturnType<typeof seedMonth>>) {
  for (const index of [0, 1, 3]) await verifyCapture(persons[index], index);
}
async function verifyCapture(
  person: Awaited<ReturnType<typeof seedMonth>>[number] | undefined,
  index: number,
) {
  if (!person) throw new Error("Missing preflight person");
  const workload = { turns: 40, captures: 20, people: 15, followups: 10, uploads: 2 };
  const step = plannedTurn(workload, index, person, new Date());
  const before = await personOutcomes(person.id);
  if (step.explicit || step.followup) await explicitCapture(step, index);
  else await casualCapture(step);
  assertTurnOutcomes(step, before, await personOutcomes(person.id));
}

async function explicitCapture(step: PlannedTurn, index: number) {
  const result = await captureExplicitOutcome({
    authority: "explicit",
    ownerUserId,
    interactionId: `cost-preflight-${index}`,
    inputMode: "typed",
    originalText: step.prompt,
    surface: "eve",
  });
  if (result.clarification) throw new Error("Capture fixture needs clarification");
}
async function casualCapture(step: PlannedTurn) {
  const { sourceRecord } = await captureSourceRecordForPerson({
    ownerUserId,
    personId: step.personId,
    retainedContent: step.prompt,
  });
  const extraction = await enqueueAndTriggerExtractionJob({
    sourceRecordId: sourceRecord.id,
    runtimeMode: "inline",
  });
  if (extraction.processResult?.outcome !== "completed")
    throw new Error("Preflight extraction failed");
}
