import {
  type ConversationalCaptureChangeTarget,
  type ConversationalCaptureClarification,
  type ConversationalCaptureRoute,
  type ConversationalCaptureUndoTarget,
  conversationalCaptureChangeRequestSchema,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureDestinationChangeRequestSchema,
  conversationalCaptureDestinationUndoRequestSchema,
  conversationalCaptureUndoRequestSchema,
  SavedItemValidationError,
  type SourceRecord,
} from "@tendnote/domain";
import type { AffectedScope, MutationOutcome } from "../../affected-scopes";
import { hydrateSavedItem } from "../../saved-items/context";
import { createSavedItemLifecycle } from "../../saved-items/lifecycle";
import { createAffectedSavedItemLifecycle } from "../../saved-items/mutation-lifecycle";
import type { SavedItemLifecycleStore, SavedItemWithContext } from "../../saved-items/types";
import { createCaptureDestination } from "./destinations";
import {
  type CaptureOutcomeReference,
  type CaptureOutcomeUndoResult,
  changeTargetReference,
  createCaptureOutcomeLifecycleOperations,
  undoTargetReference,
} from "./lifecycle-operations";
import {
  actionConfirmation,
  changeTargetKey,
  contextFactConfirmation,
  followupConfirmation,
  resolveCompletedCaptureRoute,
  resolveExactCapturePerson,
  routeDestinationLabel,
  savedItemConfirmation,
  stableRerouteUuid,
} from "./policy";
import type {
  CaptureOutcomeResult,
  CaptureVisibility,
  ConversationalCaptureDeps,
  ResolvedCapturePerson,
} from "./types";

type ResolvedRoute = Exclude<
  ConversationalCaptureRoute,
  { destination: "clarification" | "group" }
>;
type ParsedChangeOutcome = ReturnType<
  typeof conversationalCaptureDestinationChangeRequestSchema.parse
>;
type OutcomeLifecycle = ReturnType<typeof createCaptureOutcomeLifecycleOperations>;
type LoadedCaptureOutcome = Awaited<ReturnType<OutcomeLifecycle[keyof OutcomeLifecycle]["load"]>>;

export function createCorrectionOperations(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
) {
  const lifecycle = createAffectedSavedItemLifecycle(createSavedItemLifecycle(store));
  const outcomeLifecycle = createCaptureOutcomeLifecycleOperations(store, deps);

  async function changeSavedItem(input: {
    actorUserId: string;
    savedItemId: string;
    originalText: string;
  }) {
    const parsed = conversationalCaptureChangeRequestSchema.parse(input);
    const current = await store.getSavedItem({
      ownerUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
    });
    if (!current) throw new Error("That Saved Item is no longer available.");
    let url: string | null = null;
    if (current.kind === "link") {
      try {
        url = new URL(parsed.originalText).toString();
      } catch {
        throw new SavedItemValidationError("A link capture must remain a valid URL.");
      }
    }
    return (deps.editSavedItem ?? lifecycle.editSavedItem)({
      actorUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
      edit: {
        title: parsed.originalText.slice(0, 240),
        ...(current.kind === "link" ? { url } : { content: parsed.originalText }),
      },
    });
  }

  async function changeOutcome(input: {
    actorUserId: string;
    clarificationAnswer?: string;
    target: ConversationalCaptureChangeTarget;
    originalText: string;
  }) {
    const parsed = conversationalCaptureDestinationChangeRequestSchema.parse(input);
    const target = changeTargetReference(parsed.target);
    const current = await outcomeLifecycle[target.kind].load(
      parsed.actorUserId,
      target.id,
      target.sourceRecordId,
    );
    if (
      target.kind === "context_fact" &&
      target.expectedUpdatedAt &&
      current.updatedAt &&
      current.updatedAt.getTime() !== target.expectedUpdatedAt.getTime()
    ) {
      throw new Error("That Self Context capture changed elsewhere. Refresh and try again.");
    }
    const sourceRecord = await store.getSourceRecord({
      ownerUserId: parsed.actorUserId,
      sourceRecordId: current.sourceRecordId,
    });
    if (!sourceRecord) throw new Error("The original capture evidence is no longer available.");
    const route = await resolveCompletedCaptureRoute({
      deps,
      ownerUserId: parsed.actorUserId,
      originalText: parsed.originalText,
      allowSelfContext: sourceRecord.scope === "private",
      ...(parsed.clarificationAnswer ? { clarificationAnswer: parsed.clarificationAnswer } : {}),
    });
    const visibility = await correctionVisibility(store, sourceRecord, parsed.originalText);
    if (route.destination === "clarification") {
      return {
        sourceRecord,
        clarification: conversationalCaptureClarificationSchema.parse({
          field: route.field,
          question: route.question,
          sourceRecordId: sourceRecord.id,
        }),
      };
    }
    if (route.destination === "group") {
      throw new Error("Correct one captured outcome at a time.");
    }

    const personResolution = await resolveCorrectionPerson(
      deps,
      parsed.actorUserId,
      route,
      sourceRecord,
    );
    if ("result" in personResolution) return personResolution.result;
    const resolvedPerson = personResolution.resolvedPerson;

    const edited = await editSameDestination({
      deps,
      changeSavedItem,
      actorUserId: parsed.actorUserId,
      target,
      originalText: parsed.originalText,
      sourceRecordId: sourceRecord.id,
      currentPersonId: current.personId,
      currentContent: current.content,
      currentCategory: current.category,
      currentSensitivity: current.sensitivity,
      currentUpdatedAt: current.updatedAt,
      route,
      resolvedPerson,
      visibilityLabel: visibility.label,
    });
    if (edited) return { sourceRecord, ...edited };
    return rerouteCapturedOutcome({
      store,
      deps,
      outcomeLifecycle,
      parsed,
      route,
      target,
      current,
      sourceRecord,
      resolvedPerson,
      visibility,
    });
  }

  async function undoSavedItem(input: { actorUserId: string; savedItemId: string }) {
    const parsed = conversationalCaptureUndoRequestSchema.parse(input);
    const current = await store.getSavedItem({
      ownerUserId: parsed.actorUserId,
      savedItemId: parsed.savedItemId,
    });
    if (!current) throw new Error("That Saved Item is no longer available.");
    if (current.status === "archived") {
      return { result: await hydrateSavedItem(store, current), affectedScopes: [] };
    }
    return lifecycle.archiveSavedItem(parsed);
  }

  /**
   * Applies the authoritative inverse of one captured outcome.
   *
   * Returns which of the two success shapes happened — the inverse ran now, or
   * the record already held it — and throws a
   * {@link ConversationalCaptureUndoError} when it did not happen at all, so a
   * caller that has to *report* the result (Eve) can say the true one of the
   * four things without inspecting the record or matching on wording.
   */
  function undoOutcome(input: {
    actorUserId: string;
    target: ConversationalCaptureUndoTarget;
  }): Promise<CaptureOutcomeUndoResult> {
    const parsed = conversationalCaptureDestinationUndoRequestSchema.parse(input);
    const target = undoTargetReference(parsed.target);
    return outcomeLifecycle[target.kind].undo(parsed.actorUserId, target.id, target);
  }

  return { changeSavedItem, changeOutcome, undoSavedItem, undoOutcome };
}

async function correctionVisibility(
  store: SavedItemLifecycleStore,
  sourceRecord: SourceRecord,
  captureText: string,
): Promise<CaptureVisibility> {
  const sourceShares = await correctionSourceShares(store, sourceRecord);
  return {
    scope: sourceRecord.scope,
    householdId: sourceRecord.householdId ?? null,
    selectedUserIds: sourceShares.map((share) => share.sharedWithUserId),
    label: correctionVisibilityLabel(sourceRecord.scope),
    captureText,
  };
}

function correctionSourceShares(store: SavedItemLifecycleStore, sourceRecord: SourceRecord) {
  if (sourceRecord.scope !== "shared" || !sourceRecord.householdId) return Promise.resolve([]);
  return store.listHouseholdRecordShares({
    householdId: sourceRecord.householdId,
    recordKind: "source_record",
    recordId: sourceRecord.id,
  });
}

function correctionVisibilityLabel(scope: SourceRecord["scope"]) {
  if (scope === "private") return "Only me";
  if (scope === "household") return "Household";
  return "Shared audience";
}

async function resolveCorrectionPerson(
  deps: ConversationalCaptureDeps,
  actorUserId: string,
  route: ResolvedRoute,
  sourceRecord: SourceRecord,
): Promise<
  | { resolvedPerson: ResolvedCapturePerson | null }
  | { result: { sourceRecord: SourceRecord; clarification: ConversationalCaptureClarification } }
> {
  if (route.destination !== "followup" && route.destination !== "memory") {
    return { resolvedPerson: null };
  }
  const resolution = await resolveExactCapturePerson({
    deps,
    ownerUserId: actorUserId,
    personQuery: route.personQuery,
  });
  if (resolution.person) return { resolvedPerson: resolution.person };
  return {
    result: {
      sourceRecord,
      clarification: conversationalCaptureClarificationSchema.parse({
        field: "person",
        question: resolution.question,
        sourceRecordId: sourceRecord.id,
        ...(resolution.actions ? { actions: resolution.actions } : {}),
      }),
    },
  };
}

async function rerouteCapturedOutcome(input: {
  store: SavedItemLifecycleStore;
  deps: ConversationalCaptureDeps;
  outcomeLifecycle: OutcomeLifecycle;
  parsed: ParsedChangeOutcome;
  route: ResolvedRoute;
  target: CaptureOutcomeReference;
  current: LoadedCaptureOutcome;
  sourceRecord: SourceRecord;
  resolvedPerson: ResolvedCapturePerson | null;
  visibility: CaptureVisibility;
}) {
  const to = routeDestinationLabel(input.route);
  if (!to) throw new Error("Correction still needs clarification.");
  await assertSafePersonReroute(
    input.deps,
    input.parsed.actorUserId,
    input.target,
    input.sourceRecord,
  );
  const rerouteId = createRerouteId(input.parsed, input.sourceRecord.id, to);
  const corrected = await createReroutedDestination(input, rerouteId);
  await shareCorrectedMemory(input.store, input.parsed.actorUserId, input.visibility, corrected);
  const archived = await input.outcomeLifecycle[input.target.kind].archive(
    input.parsed.actorUserId,
    input.target.id,
    input.current.status,
    input.target,
  );
  await writeRerouteAudit(input, corrected, to, rerouteId("audit"));
  return {
    sourceRecord: input.sourceRecord,
    ...corrected,
    affectedScopes: [
      ...affectedScopesFromUnknown(corrected),
      ...affectedScopesFromUnknown(archived),
    ],
  };
}

function affectedScopesFromUnknown(value: unknown): AffectedScope[] {
  if (!value || typeof value !== "object" || !("affectedScopes" in value)) return [];
  const scopes = value.affectedScopes;
  return Array.isArray(scopes) ? (scopes as AffectedScope[]) : [];
}

async function assertSafePersonReroute(
  deps: ConversationalCaptureDeps,
  actorUserId: string,
  target: CaptureOutcomeReference,
  sourceRecord: SourceRecord,
) {
  if (target.kind !== "person") return;
  if (!target.createdByCapture) {
    if (!deps.unlinkCapturedPerson) throw new Error("Person correction is unavailable.");
    return;
  }
  if (!deps.assertCapturedPersonRemovable) throw new Error("Person correction is unavailable.");
  await deps.assertCapturedPersonRemovable({
    ownerUserId: actorUserId,
    personId: target.id,
    sourceRecordId: sourceRecord.id,
  });
}

function createRerouteId(parsed: ParsedChangeOutcome, sourceRecordId: string, destination: string) {
  const transitionKey = `${changeTargetKey(parsed.target)}:${destination}`;
  return (recordKind: Parameters<typeof stableRerouteUuid>[0]["recordKind"]) =>
    stableRerouteUuid({
      ownerUserId: parsed.actorUserId,
      sourceRecordId,
      transitionKey,
      recordKind,
    });
}

function createReroutedDestination(
  input: Parameters<typeof rerouteCapturedOutcome>[0],
  rerouteId: ReturnType<typeof createRerouteId>,
) {
  return createCaptureDestination({
    store: input.store,
    deps: input.deps,
    route: input.route,
    resolvedPerson: input.resolvedPerson,
    ownerUserId: input.parsed.actorUserId,
    originalText: input.parsed.originalText,
    sourceRecordId: input.sourceRecord.id,
    visibility: input.visibility,
    ...(input.target.kind === "asset_review"
      ? { excludedAssetReviewGroupId: input.target.id }
      : {}),
    ids: {
      savedItemId: rerouteId("saved_item"),
      savedItemEventId: rerouteId("saved_item_event"),
      generalActionId: rerouteId("general_action"),
      followupId: rerouteId("followup"),
    },
  });
}

async function shareCorrectedMemory(
  store: SavedItemLifecycleStore,
  actorUserId: string,
  visibility: CaptureVisibility,
  corrected: CaptureOutcomeResult,
) {
  if (visibility.scope !== "shared" || !visibility.householdId) return;
  if (corrected.kind !== "memory") return;
  for (const sharedWithUserId of visibility.selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId: visibility.householdId,
      recordKind: "memory",
      recordId: corrected.memory.id,
      sharedWithUserId,
      sharedByUserId: actorUserId,
    });
  }
}

function writeRerouteAudit(
  input: Parameters<typeof rerouteCapturedOutcome>[0],
  corrected: CaptureOutcomeResult,
  to: string,
  auditId: string,
) {
  return input.store.createSourceRecordAuditLogEntry({
    id: auditId,
    ownerUserId: input.parsed.actorUserId,
    action: "capture.reroute",
    entityType: "source_record",
    entityId: input.sourceRecord.id,
    metadataJson: {
      from: input.current.from,
      fromStatus: input.current.status,
      to,
      correctedRecordId: corrected.id,
    },
  });
}

type EditSameDestinationInput = {
  deps: ConversationalCaptureDeps;
  changeSavedItem: (input: {
    actorUserId: string;
    savedItemId: string;
    originalText: string;
  }) => Promise<MutationOutcome<SavedItemWithContext>>;
  actorUserId: string;
  target: CaptureOutcomeReference;
  originalText: string;
  sourceRecordId: string;
  currentPersonId?: string;
  currentContent?: string;
  currentCategory?: LoadedCaptureOutcome["category"];
  currentSensitivity?: LoadedCaptureOutcome["sensitivity"];
  currentUpdatedAt?: LoadedCaptureOutcome["updatedAt"];
  route: ResolvedRoute;
  resolvedPerson: ResolvedCapturePerson | null;
  visibilityLabel: string;
};

async function editSameDestination(input: EditSameDestinationInput) {
  const contextFact = await editContextFactDestination(input);
  if (contextFact) return contextFact;
  const person = await editPersonDestination(input);
  if (person) return person;
  const memory = await keepUnchangedMemoryDestination(input);
  if (memory) return memory;
  const savedItem = await editSavedItemDestination(input);
  if (savedItem) return savedItem;
  const action = await editActionDestination(input);
  if (action) return action;
  const followup = await editFollowupDestination(input);
  if (followup) return followup;
  return null;
}

async function editContextFactDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "context_fact" || input.route.destination !== "context_fact")
    return null;
  if (
    input.currentCategory === input.route.category &&
    input.currentContent === input.route.content &&
    input.currentSensitivity === input.route.sensitivity
  ) {
    if (!input.deps.createSelfContextFact) {
      throw new Error("Self Context correction is unavailable.");
    }
    const outcome = await input.deps.createSelfContextFact({
      ownerUserId: input.actorUserId,
      category: input.route.category,
      content: input.route.content,
      sensitivity: input.route.sensitivity,
      sourceRecordId: input.sourceRecordId,
    });
    return {
      contextFact: outcome.result,
      affectedScopes: outcome.affectedScopes,
      confirmation: conversationalCaptureConfirmationSchema.parse(
        contextFactConfirmation({
          sourceRecordId: input.sourceRecordId,
          contextFactId: input.target.id,
          route: input.route,
          visibilityLabel: input.visibilityLabel,
          expectedUpdatedAt: outcome.result.updatedAt,
        }),
      ),
    };
  }
  if (
    !input.deps.updateSelfContextFact ||
    !input.currentContent ||
    !input.currentCategory ||
    input.currentCategory === "composition"
  ) {
    throw new Error("Self Context correction is unavailable.");
  }
  const outcome = await input.deps.updateSelfContextFact({
    actorUserId: input.actorUserId,
    contextFactId: input.target.id,
    category: input.route.category,
    content: input.route.content,
    sensitivity: input.route.sensitivity,
    ...(input.currentUpdatedAt ? { expectedUpdatedAt: input.currentUpdatedAt } : {}),
  });
  return {
    contextFact: outcome.result,
    affectedScopes: outcome.affectedScopes,
    confirmation: conversationalCaptureConfirmationSchema.parse(
      contextFactConfirmation({
        sourceRecordId: input.sourceRecordId,
        contextFactId: input.target.id,
        route: input.route,
        visibilityLabel: input.visibilityLabel,
        expectedUpdatedAt: outcome.result.updatedAt,
        undo: {
          kind: "edit_context_fact",
          contextFactId: input.target.id,
          sourceRecordId: input.sourceRecordId,
          category: input.currentCategory,
          content: input.currentContent,
          sensitivity: input.currentSensitivity ?? "normal",
          expectedUpdatedAt: outcome.result.updatedAt.toISOString(),
        },
      }),
    ),
  };
}

async function editPersonDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "person" || input.route.destination !== "person") return null;
  if (!input.target.createdByCapture) return unchangedEstablishedPerson(input);
  if (!input.deps.updatePerson) throw new Error("Person correction is unavailable.");
  const outcome = await input.deps.updatePerson({
    ownerUserId: input.actorUserId,
    personId: input.target.id,
    displayName: input.route.displayName,
  });
  const person = outcome.result;
  if (!person) throw new Error("That Person is no longer available.");
  return {
    ...personCorrectionResult(input, person, true),
    affectedScopes: outcome.affectedScopes,
  };
}

async function unchangedEstablishedPerson(input: EditSameDestinationInput) {
  if (input.route.destination !== "person") return null;
  const currentName = input.currentContent?.trim().toLocaleLowerCase();
  if (currentName !== input.route.displayName.trim().toLocaleLowerCase()) return null;
  const person = await input.deps.getPerson?.({
    ownerUserId: input.actorUserId,
    personId: input.target.id,
  });
  if (!person) throw new Error("That Person is no longer available.");
  return personCorrectionResult(input, person, false);
}

function personCorrectionResult(
  input: EditSameDestinationInput,
  person: ResolvedCapturePerson,
  createdByCapture: boolean,
) {
  return {
    person,
    confirmation: conversationalCaptureConfirmationSchema.parse({
      destination: "People",
      groundedBySourceRecordId: input.sourceRecordId,
      interpreted: { displayName: person.displayName, scope: input.visibilityLabel },
      change: {
        kind: "edit_person",
        personId: person.id,
        sourceRecordId: input.sourceRecordId,
        createdByCapture,
      },
    }),
  };
}

async function keepUnchangedMemoryDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "memory" || input.route.destination !== "memory") return null;
  const resolvedPerson = input.resolvedPerson;
  if (!resolvedPerson || resolvedPerson.id !== input.currentPersonId) return null;
  if (input.route.content !== input.currentContent) return null;
  const memory = await input.deps.getMemory?.({
    ownerUserId: input.actorUserId,
    memoryId: input.target.id,
  });
  if (!memory) throw new Error("That Memory is no longer available.");
  return {
    memory,
    confirmation: conversationalCaptureConfirmationSchema.parse({
      destination: "Memories",
      groundedBySourceRecordId: input.sourceRecordId,
      interpreted: {
        person: resolvedPerson.displayName,
        authority: "Approved",
        scope: input.visibilityLabel,
      },
      change: {
        kind: "edit_memory",
        memoryId: memory.id,
        sourceRecordId: input.sourceRecordId,
      },
      undo: { kind: "archive_memory", memoryId: memory.id },
    }),
  };
}

async function editSavedItemDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "saved_item" || input.route.destination !== "saved_item") return null;
  const outcome = await input.changeSavedItem({
    actorUserId: input.actorUserId,
    savedItemId: input.target.id,
    originalText: input.originalText,
  });
  return {
    savedItem: outcome.result,
    affectedScopes: outcome.affectedScopes,
    confirmation: conversationalCaptureConfirmationSchema.parse(
      savedItemConfirmation({
        sourceRecordId: input.sourceRecordId,
        savedItemId: input.target.id,
        kind: outcome.result.kind,
        visibilityLabel: input.visibilityLabel,
      }),
    ),
  };
}

async function editActionDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "general_action" || input.route.destination !== "action") return null;
  if (!input.deps.editGeneralAction) throw new Error("Action correction is unavailable.");
  const outcome = await input.deps.editGeneralAction({
    actorUserId: input.actorUserId,
    generalActionId: input.target.id,
    edit: {
      title: input.route.title,
      dueAt: input.route.dueAt,
      recurrence: input.route.recurrence,
    },
  });
  return {
    generalAction: outcome.result,
    affectedScopes: outcome.affectedScopes,
    confirmation: conversationalCaptureConfirmationSchema.parse(
      actionConfirmation({
        sourceRecordId: input.sourceRecordId,
        generalActionId: input.target.id,
        route: input.route,
        visibilityLabel: input.visibilityLabel,
      }),
    ),
  };
}

async function editFollowupDestination(input: EditSameDestinationInput) {
  if (input.target.kind !== "followup" || input.route.destination !== "followup") return null;
  const resolvedPerson = input.resolvedPerson;
  if (!resolvedPerson || resolvedPerson.id !== input.currentPersonId) return null;
  if (!input.deps.editFollowup) throw new Error("Follow-Up correction is unavailable.");
  const outcome = await input.deps.editFollowup({
    actorUserId: input.actorUserId,
    followupId: input.target.id,
    edit: { reason: input.route.reason, dueAt: input.route.dueAt },
  });
  return {
    followup: outcome.result,
    affectedScopes: outcome.affectedScopes,
    confirmation: conversationalCaptureConfirmationSchema.parse(
      followupConfirmation({
        sourceRecordId: input.sourceRecordId,
        followupId: input.target.id,
        person: resolvedPerson,
        route: input.route,
        visibilityLabel: input.visibilityLabel,
      }),
    ),
  };
}
