"use server";

import { getPersonUpdateStatus, undoPersonUpdate } from "@tendnote/db/queries/people";
import { type PersonUpdateTarget, personUpdateTargetSchema } from "@tendnote/domain";
import { runOwnerAction } from "@/lib/owner-action";

export async function undoPersonUpdateAction(input: PersonUpdateTarget) {
  return runOwnerAction({
    schema: personUpdateTargetSchema,
    input,
    body: ({ ownerUserId, input: target }) => undoPersonUpdate({ ...target, ownerUserId }),
    affectedScopes: (outcome) => outcome.affectedScopes,
    result: (outcome) => outcome.result,
  });
}

export async function getPersonUpdateStatusAction(input: PersonUpdateTarget) {
  return runOwnerAction({
    schema: personUpdateTargetSchema,
    input,
    body: ({ ownerUserId, input: target }) => getPersonUpdateStatus({ ...target, ownerUserId }),
    result: (view) => view,
  });
}
