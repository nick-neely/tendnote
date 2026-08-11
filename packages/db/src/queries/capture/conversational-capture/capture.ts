import {
  type ConversationalCaptureRoute,
  conversationalCaptureClarificationSchema,
  conversationalCaptureConfirmationSchema,
  conversationalCaptureRequestSchema,
  createSourceRecordSchema,
  type SourceRecord,
} from "@tendnote/domain";
import type { SavedItemLifecycleStore } from "../../saved-items/types";
import {
  type CaptureDestinationIds,
  createCaptureDestination,
  createInferredCaptureReview,
} from "./destinations";
import {
  captureInputHash,
  resolveCompletedCaptureRoute,
  resolveExactCapturePerson,
  stableCaptureUuid,
} from "./policy";
import type {
  CaptureOutcomeResult,
  CaptureVisibility,
  ConversationalCaptureDeps,
  ConversationalCaptureInput,
  ConversationalCaptureResult,
  ResolvedCapturePerson,
} from "./types";

type ParsedCaptureInput = ReturnType<typeof conversationalCaptureRequestSchema.parse>;
type ResolvedRoute = Exclude<
  ConversationalCaptureRoute,
  { destination: "clarification" | "group" }
>;

export function createCaptureOperation(
  store: SavedItemLifecycleStore,
  deps: ConversationalCaptureDeps,
) {
  return async function capture(
    input: ConversationalCaptureInput,
  ): Promise<ConversationalCaptureResult> {
    const parsedInput = conversationalCaptureRequestSchema.parse(input);
    const visibility = await resolveCaptureVisibility(deps, parsedInput);
    const route = await resolveCompletedCaptureRoute({
      deps,
      ownerUserId: parsedInput.ownerUserId,
      originalText: visibility.captureText,
      allowSelfContext: visibility.scope === "private",
      ...(parsedInput.clarificationAnswer
        ? { clarificationAnswer: parsedInput.clarificationAnswer }
        : {}),
    });
    let sourceRecord = await loadOrCreateCaptureSource({
      store,
      parsedInput,
      route,
      visibility,
    });
    if (route.destination === "clarification") {
      return clarificationResult(sourceRecord, route);
    }

    const routes = route.destination === "group" ? route.outcomes : [route];
    const peopleResolution = await resolveCapturePeople({
      store,
      deps,
      parsedInput,
      routes,
      sourceRecord,
    });
    if ("result" in peopleResolution) return peopleResolution.result;

    const orderedOutcomes = await persistCaptureDestinations({
      store,
      deps,
      parsedInput,
      routes,
      sourceRecord,
      visibility,
      ...peopleResolution,
    });
    const inferredOutcomes = await persistInferredCaptureReviews(
      deps,
      parsedInput,
      sourceRecord.id,
    );
    await shareMemoryOutcomes(store, parsedInput.ownerUserId, visibility, orderedOutcomes);
    sourceRecord = await activateResolvedSource(store, parsedInput.ownerUserId, sourceRecord);
    return captureResult({
      sourceRecord,
      route,
      orderedOutcomes,
      inferredOutcomes,
    });
  };
}

async function resolveCaptureVisibility(
  deps: ConversationalCaptureDeps,
  parsedInput: ParsedCaptureInput,
): Promise<CaptureVisibility> {
  if (!deps.resolveVisibility) {
    return {
      scope: "private",
      householdId: null,
      selectedUserIds: [],
      label: "Only me",
      captureText: parsedInput.originalText,
    };
  }
  return deps.resolveVisibility({
    ownerUserId: parsedInput.ownerUserId,
    originalText: parsedInput.originalText,
    ...(parsedInput.contextVisibility ? { contextVisibility: parsedInput.contextVisibility } : {}),
    ...(parsedInput.requestedScope ? { requestedScope: parsedInput.requestedScope } : {}),
  });
}

async function loadOrCreateCaptureSource(input: {
  store: SavedItemLifecycleStore;
  parsedInput: ParsedCaptureInput;
  route: ConversationalCaptureRoute;
  visibility: CaptureVisibility;
}) {
  const sourceRecordId = stableCaptureUuid(input.parsedInput, "source");
  const inputHash = captureInputHash(input.parsedInput, input.parsedInput.originalText);
  const existing = await input.store.getSourceRecord({
    ownerUserId: input.parsedInput.ownerUserId,
    sourceRecordId,
  });
  if (existing) {
    assertCaptureInputHash(existing, inputHash);
    return existing;
  }
  const sourceRecord = await createCaptureSource(input, sourceRecordId, inputHash);
  assertCaptureInputHash(sourceRecord, inputHash);
  await shareCaptureSource(
    input.store,
    input.parsedInput.ownerUserId,
    input.visibility,
    sourceRecord,
  );
  await writeCaptureSourceAudit(input.store, input.parsedInput, input.route, sourceRecord.id);
  return sourceRecord;
}

function assertCaptureInputHash(sourceRecord: SourceRecord, inputHash: string) {
  if (sourceRecord.metadataJson.captureInputHash !== inputHash) {
    throw new Error("This capture interaction was already used for different input.");
  }
}

function createCaptureSource(
  input: {
    store: SavedItemLifecycleStore;
    parsedInput: ParsedCaptureInput;
    route: ConversationalCaptureRoute;
    visibility: CaptureVisibility;
  },
  sourceRecordId: string,
  inputHash: string,
) {
  return input.store.createSourceRecord(
    createSourceRecordSchema.parse({
      id: sourceRecordId,
      ownerUserId: input.parsedInput.ownerUserId,
      sourceType: "manual",
      content: input.parsedInput.originalText,
      rawContent: null,
      retentionPolicy: "retain",
      status: routeMayNeedResolution(input.route) ? "pending_resolution" : "active",
      confidence: "high",
      sensitivity: captureSourceSensitivity(input.route),
      scope: input.visibility.scope,
      householdId: input.visibility.householdId,
      importance: 3,
      metadataJson: {
        audioRetained: false,
        authority: input.parsedInput.authority,
        captureSurface: input.parsedInput.surface,
        captureInputHash: inputHash,
        inputMode: input.parsedInput.inputMode,
        interactionId: input.parsedInput.interactionId,
      },
    }),
  );
}

function captureSourceSensitivity(route: ConversationalCaptureRoute): SourceRecord["sensitivity"] {
  if (route.destination === "context_fact") return route.sensitivity;
  if (route.destination === "group") {
    const contextFactSensitivities = route.outcomes
      .filter((outcome) => outcome.destination === "context_fact")
      .map((outcome) => (outcome.destination === "context_fact" ? outcome.sensitivity : null))
      .filter(
        (sensitivity): sensitivity is NonNullable<typeof sensitivity> => sensitivity !== null,
      );
    if (contextFactSensitivities.includes("restricted")) return "restricted";
    if (contextFactSensitivities.includes("sensitive")) return "sensitive";
  }
  return "normal";
}

async function shareCaptureSource(
  store: SavedItemLifecycleStore,
  ownerUserId: string,
  visibility: CaptureVisibility,
  sourceRecord: SourceRecord,
) {
  if (visibility.scope !== "shared" || !visibility.householdId) return;
  for (const sharedWithUserId of visibility.selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId: visibility.householdId,
      recordKind: "source_record",
      recordId: sourceRecord.id,
      sharedWithUserId,
      sharedByUserId: ownerUserId,
    });
  }
}

function writeCaptureSourceAudit(
  store: SavedItemLifecycleStore,
  parsedInput: ParsedCaptureInput,
  route: ConversationalCaptureRoute,
  sourceRecordId: string,
) {
  return store.createSourceRecordAuditLogEntry({
    id: stableCaptureUuid(parsedInput, "source_audit"),
    ownerUserId: parsedInput.ownerUserId,
    action: `capture.explicit_${route.destination}_source_created`,
    entityType: "source_record",
    entityId: sourceRecordId,
    metadataJson: {
      authority: parsedInput.authority,
      captureSurface: parsedInput.surface,
      inputMode: parsedInput.inputMode,
    },
  });
}

function clarificationResult(
  sourceRecord: SourceRecord,
  route: Extract<ConversationalCaptureRoute, { destination: "clarification" }>,
): ConversationalCaptureResult {
  return {
    sourceRecord,
    clarification: conversationalCaptureClarificationSchema.parse({
      field: route.field,
      question: route.question,
      sourceRecordId: sourceRecord.id,
    }),
  };
}

type CapturePeopleState = {
  plannedPeople: Map<string, number>;
  resolvedPeople: Map<number, ResolvedCapturePerson>;
  unresolvedMentionIds: Map<number, string>;
};

async function resolveCapturePeople(input: {
  store: SavedItemLifecycleStore;
  deps: ConversationalCaptureDeps;
  parsedInput: ParsedCaptureInput;
  routes: ResolvedRoute[];
  sourceRecord: SourceRecord;
}): Promise<CapturePeopleState | { result: ConversationalCaptureResult }> {
  const state: CapturePeopleState = {
    plannedPeople: plannedPersonRoutes(input.routes),
    resolvedPeople: new Map(),
    unresolvedMentionIds: new Map(),
  };
  let clarificationAnswer = input.parsedInput.clarificationAnswer;
  for (const [index, candidate] of input.routes.entries()) {
    const personQuery = routePersonQuery(candidate);
    if (!personQuery || state.plannedPeople.has(normalizePersonQuery(personQuery))) continue;
    const resolution = await resolveExactCapturePerson({
      deps: input.deps,
      ownerUserId: input.parsedInput.ownerUserId,
      personQuery: clarificationAnswer ?? personQuery,
    });
    clarificationAnswer = undefined;
    if (!resolution.person) {
      const unresolvedMention = await findOrCreateUnresolvedMention(
        input.store,
        input.sourceRecord.id,
        personQuery,
        resolution.candidatePersonIds,
      );
      return {
        result: unresolvedPersonResult(input.sourceRecord, resolution, unresolvedMention.id),
      };
    }
    state.resolvedPeople.set(index, resolution.person);
    const unresolvedMentionId = await findExistingUnresolvedMention(
      input.store,
      input.sourceRecord.id,
      personQuery,
    );
    if (unresolvedMentionId) state.unresolvedMentionIds.set(index, unresolvedMentionId);
  }
  return state;
}

function plannedPersonRoutes(routes: ResolvedRoute[]) {
  return new Map(
    routes.flatMap((candidate, index) =>
      candidate.destination === "person"
        ? [[normalizePersonQuery(candidate.displayName), index] as const]
        : [],
    ),
  );
}

async function findOrCreateUnresolvedMention(
  store: SavedItemLifecycleStore,
  sourceRecordId: string,
  personQuery: string,
  candidatePersonIds: string[],
) {
  const existingId = await findExistingUnresolvedMention(store, sourceRecordId, personQuery);
  if (existingId) {
    const mentions = await store.listUnresolvedMentions({ sourceRecordId });
    const existing = mentions.find((mention) => mention.id === existingId);
    if (existing) return existing;
  }
  return store.createUnresolvedMention({
    sourceRecordId,
    mentionText: personQuery,
    candidatePersonIds,
  });
}

async function findExistingUnresolvedMention(
  store: SavedItemLifecycleStore,
  sourceRecordId: string,
  personQuery: string,
) {
  const normalized = normalizePersonQuery(personQuery);
  const mention = (await store.listUnresolvedMentions({ sourceRecordId })).find(
    (candidate) =>
      candidate.status === "unresolved" &&
      normalizePersonQuery(candidate.mentionText) === normalized,
  );
  return mention?.id;
}

function unresolvedPersonResult(
  sourceRecord: SourceRecord,
  resolution: Awaited<ReturnType<typeof resolveExactCapturePerson>>,
  unresolvedMentionId: string,
): ConversationalCaptureResult {
  return {
    sourceRecord,
    clarification: conversationalCaptureClarificationSchema.parse({
      field: "person",
      question: resolution.question,
      sourceRecordId: sourceRecord.id,
      ...(resolution.actions
        ? {
            actions: resolution.actions.map((action) =>
              action.kind === "add_person" ? { ...action, unresolvedMentionId } : action,
            ),
          }
        : {}),
    }),
  };
}

async function persistCaptureDestinations(
  input: {
    store: SavedItemLifecycleStore;
    deps: ConversationalCaptureDeps;
    parsedInput: ParsedCaptureInput;
    routes: ResolvedRoute[];
    sourceRecord: SourceRecord;
    visibility: CaptureVisibility;
  } & CapturePeopleState,
) {
  const outcomes = new Map<number, CaptureOutcomeResult>();
  await persistPersonDestinations(input, outcomes);
  await persistNonPersonDestinations(input, outcomes);
  return input.routes.map((_, index) => requireCaptureOutcome(outcomes, index));
}

async function persistPersonDestinations(
  input: Parameters<typeof persistCaptureDestinations>[0],
  outcomes: Map<number, CaptureOutcomeResult>,
) {
  for (const [index, candidate] of input.routes.entries()) {
    if (candidate.destination !== "person") continue;
    const outcome = await persistDestination(input, candidate, null, index);
    outcomes.set(index, outcome);
    if (outcome.kind === "person") input.resolvedPeople.set(index, outcome.person);
  }
}

async function persistNonPersonDestinations(
  input: Parameters<typeof persistCaptureDestinations>[0],
  outcomes: Map<number, CaptureOutcomeResult>,
) {
  for (const [index, candidate] of input.routes.entries()) {
    if (candidate.destination === "person") continue;
    const resolvedPerson = resolvedPersonForRoute(input, candidate, index);
    await linkCapturePerson(input, candidate, resolvedPerson, index);
    outcomes.set(index, await persistDestination(input, candidate, resolvedPerson, index));
  }
}

function resolvedPersonForRoute(
  input: Parameters<typeof persistCaptureDestinations>[0],
  candidate: ResolvedRoute,
  index: number,
) {
  const personQuery = routePersonQuery(candidate);
  const plannedPersonIndex = personQuery
    ? input.plannedPeople.get(normalizePersonQuery(personQuery))
    : undefined;
  return input.resolvedPeople.get(plannedPersonIndex ?? index) ?? null;
}

async function linkCapturePerson(
  input: Parameters<typeof persistCaptureDestinations>[0],
  candidate: ResolvedRoute,
  resolvedPerson: ResolvedCapturePerson | null,
  index: number,
) {
  if (candidate.destination !== "followup" && candidate.destination !== "memory") return;
  if (!resolvedPerson || !input.deps.linkSourceRecordToPerson) return;
  await input.deps.linkSourceRecordToPerson({
    ownerUserId: input.parsedInput.ownerUserId,
    sourceRecordId: input.sourceRecord.id,
    personId: resolvedPerson.id,
    role: "primary",
    ...(input.unresolvedMentionIds.get(index)
      ? { unresolvedMentionId: input.unresolvedMentionIds.get(index) }
      : {}),
  });
}

function persistDestination(
  input: Parameters<typeof persistCaptureDestinations>[0],
  route: ResolvedRoute,
  resolvedPerson: ResolvedCapturePerson | null,
  index: number,
) {
  return createCaptureDestination({
    store: input.store,
    deps: input.deps,
    route,
    resolvedPerson,
    ownerUserId: input.parsedInput.ownerUserId,
    originalText: input.visibility.captureText,
    sourceRecordId: input.sourceRecord.id,
    visibility: input.visibility,
    ids: captureDestinationIds(input.parsedInput, index),
  });
}

function captureDestinationIds(
  parsedInput: ParsedCaptureInput,
  index: number,
): CaptureDestinationIds {
  const key = (kind: "saved_item" | "saved_item_event" | "general_action" | "followup") =>
    stableCaptureUuid(parsedInput, index === 0 ? kind : `${kind}:${index}`);
  return {
    savedItemId: key("saved_item"),
    savedItemEventId: key("saved_item_event"),
    generalActionId: key("general_action"),
    followupId: key("followup"),
  };
}

function requireCaptureOutcome(outcomes: Map<number, CaptureOutcomeResult>, index: number) {
  const outcome = outcomes.get(index);
  if (!outcome) throw new Error("Capture outcome was not persisted.");
  return outcome;
}

async function persistInferredCaptureReviews(
  deps: ConversationalCaptureDeps,
  parsedInput: ParsedCaptureInput,
  sourceRecordId: string,
) {
  const outcomes: CaptureOutcomeResult[] = [];
  for (const suggestion of parsedInput.inferredSuggestions ?? []) {
    outcomes.push(
      await createInferredCaptureReview({
        deps,
        ownerUserId: parsedInput.ownerUserId,
        sourceRecordId,
        suggestion,
      }),
    );
  }
  return outcomes;
}

async function shareMemoryOutcomes(
  store: SavedItemLifecycleStore,
  ownerUserId: string,
  visibility: CaptureVisibility,
  outcomes: CaptureOutcomeResult[],
) {
  if (visibility.scope !== "shared" || !visibility.householdId) return;
  for (const outcome of outcomes) {
    if (outcome.kind !== "memory") continue;
    await shareMemoryOutcome(
      store,
      ownerUserId,
      visibility.householdId,
      visibility.selectedUserIds,
      outcome.memory.id,
    );
  }
}

async function shareMemoryOutcome(
  store: SavedItemLifecycleStore,
  ownerUserId: string,
  householdId: string,
  selectedUserIds: string[],
  memoryId: string,
) {
  for (const sharedWithUserId of selectedUserIds) {
    await store.createHouseholdRecordShare({
      householdId,
      recordKind: "memory",
      recordId: memoryId,
      sharedWithUserId,
      sharedByUserId: ownerUserId,
    });
  }
}

async function activateResolvedSource(
  store: SavedItemLifecycleStore,
  ownerUserId: string,
  sourceRecord: SourceRecord,
) {
  if (sourceRecord.status !== "pending_resolution") return sourceRecord;
  return store.updateSourceRecordStatus({
    ownerUserId,
    sourceRecordId: sourceRecord.id,
    status: "active",
  });
}

function captureResult(input: {
  sourceRecord: SourceRecord;
  route: Exclude<ConversationalCaptureRoute, { destination: "clarification" }>;
  orderedOutcomes: CaptureOutcomeResult[];
  inferredOutcomes: CaptureOutcomeResult[];
}): ConversationalCaptureResult {
  const allOutcomes = [...input.orderedOutcomes, ...input.inferredOutcomes];
  if (input.route.destination !== "group" && input.inferredOutcomes.length === 0) {
    return { sourceRecord: input.sourceRecord, ...input.orderedOutcomes[0] };
  }
  return {
    sourceRecord: input.sourceRecord,
    outcomes: allOutcomes,
    affectedScopes: allOutcomes.flatMap((outcome) => outcome.affectedScopes ?? []),
    confirmation: conversationalCaptureConfirmationSchema.parse({
      destination: "Grouped",
      groundedBySourceRecordId: input.sourceRecord.id,
      outcomes: allOutcomes.map((outcome) => outcome.confirmation),
    }),
  };
}

function routePersonQuery(route: ResolvedRoute) {
  return route.destination === "followup" || route.destination === "memory"
    ? route.personQuery
    : null;
}

function normalizePersonQuery(value: string) {
  return value.trim().toLocaleLowerCase();
}

function routeMayNeedResolution(route: ConversationalCaptureRoute) {
  if (route.destination === "clarification" || route.destination === "followup") return true;
  if (route.destination === "memory" || route.destination === "group") return true;
  return false;
}
