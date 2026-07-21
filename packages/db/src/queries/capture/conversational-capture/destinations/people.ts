import type { CaptureDestinationInput, ResolvedCaptureRoute } from "../destinations";
import { parseOutcomeConfirmation } from "./confirmation";

export async function createPersonDestination(
  input: CaptureDestinationInput<Extract<ResolvedCaptureRoute, { destination: "person" }>>,
) {
  const result = await input.deps.resolveOrCreateAndLinkPerson?.({
    ownerUserId: input.ownerUserId,
    sourceRecordId: input.sourceRecordId,
    displayName: input.route.displayName,
    role: "primary",
  });
  if (!result?.person) throw new Error("Person capture is unavailable.");
  const confirmation = parseOutcomeConfirmation({
    destination: "People",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: { displayName: result.person.displayName, scope: input.visibility.label },
    change: {
      kind: "edit_person",
      personId: result.person.id,
      sourceRecordId: input.sourceRecordId,
      createdByCapture: result.created,
    },
  });
  return { kind: "person" as const, person: result.person, confirmation, id: result.person.id };
}
