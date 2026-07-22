import { createHash } from "node:crypto";
import {
  type ConversationalCaptureChangeTarget,
  type ConversationalCaptureConfirmation,
  type ConversationalCaptureRoute,
  routeExplicitConversationalCapture,
  type SavedItemKind,
} from "@tendnote/domain";
import type {
  ConversationalCaptureDeps,
  ConversationalCaptureInput,
  ResolvedCapturePerson,
} from "./types";

const VAGUE_TIMING = /\b(?:sometime|soon|later|eventually)\b/gi;
const VAGUE_CADENCE = /\b(?:regularly|periodically|often)\b/gi;
const EXPLICIT_MONTH_DAY =
  /\bon\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/gi;
const NUMBERED_CADENCE = /\bevery\s+\d+\s+(?:days?|weeks?|months?|years?)\b/gi;

export function fallbackKind(originalText: string): SavedItemKind {
  try {
    new URL(originalText);
    return "link";
  } catch {
    return originalText.endsWith("?") ? "open_question" : "note";
  }
}

function kindLabel(kind: SavedItemKind) {
  if (kind === "open_question") return "Open question" as const;
  return kind === "link" ? ("Link" as const) : ("Note" as const);
}

type CaptureRecordKind =
  | "source"
  | "source_audit"
  | `${"saved_item" | "saved_item_event" | "general_action" | "followup"}${"" | `:${number}`}`;

export function stableCaptureUuid(
  input: ConversationalCaptureInput,
  recordKind: CaptureRecordKind,
) {
  return stableUuid(`capture:${recordKind}:${input.ownerUserId}:${input.interactionId}`);
}

export function captureInputHash(input: ConversationalCaptureInput, originalText: string) {
  return createHash("sha256")
    .update(
      `${input.surface}\0${input.inputMode}\0${originalText}\0${JSON.stringify(input.contextVisibility ?? null)}\0${JSON.stringify(input.inferredSuggestions ?? [])}`,
    )
    .digest("hex");
}

export function stableRerouteUuid(input: {
  ownerUserId: string;
  sourceRecordId: string;
  transitionKey: string;
  recordKind: "saved_item" | "saved_item_event" | "general_action" | "followup" | "audit";
}) {
  return stableUuid(
    `capture:reroute:${input.recordKind}:${input.ownerUserId}:${input.sourceRecordId}:${input.transitionKey}`,
  );
}

function stableUuid(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

async function capturePolicyContext(deps: ConversationalCaptureDeps, ownerUserId: string) {
  return {
    now: deps.now?.() ?? new Date(),
    timeZone: (await deps.ownerTimeZone?.(ownerUserId)) ?? "UTC",
  };
}

export async function resolveCompletedCaptureRoute(input: {
  deps: ConversationalCaptureDeps;
  ownerUserId: string;
  originalText: string;
  clarificationAnswer?: string;
}) {
  const policyContext = await capturePolicyContext(input.deps, input.ownerUserId);
  const initialRoute = routeExplicitConversationalCapture({
    originalText: input.originalText,
    ...policyContext,
  });
  const routingText = clarificationRoutingText({
    initialRoute,
    originalText: input.originalText,
    clarificationAnswer: input.clarificationAnswer,
  });
  const resolvedRoute = routeExplicitConversationalCapture({
    originalText: routingText,
    ...policyContext,
  });
  return input.clarificationAnswer &&
    (initialRoute.destination === "followup" || initialRoute.destination === "memory") &&
    (resolvedRoute.destination === "followup" || resolvedRoute.destination === "memory")
    ? { ...resolvedRoute, personQuery: input.clarificationAnswer }
    : resolvedRoute;
}

function clarificationRoutingText(input: {
  initialRoute: ConversationalCaptureRoute;
  originalText: string;
  clarificationAnswer?: string;
}) {
  if (!input.clarificationAnswer) return input.originalText;
  let base = input.originalText;
  if (input.initialRoute.destination === "clarification") {
    if (input.initialRoute.field === "timing") {
      base = base.replace(VAGUE_TIMING, "").replace(EXPLICIT_MONTH_DAY, "");
    } else if (input.initialRoute.field === "cadence") {
      base = base.replace(VAGUE_CADENCE, "").replace(NUMBERED_CADENCE, "");
    }
  }
  return `${base} ${input.clarificationAnswer}`;
}

export async function resolveExactCapturePerson(input: {
  deps: ConversationalCaptureDeps;
  ownerUserId: string;
  personQuery: string;
}) {
  const people =
    (await input.deps.searchPeople?.({
      ownerUserId: input.ownerUserId,
      query: input.personQuery,
      limit: 3,
    })) ?? [];
  const exactPeople = people.filter(
    (person) =>
      person.displayName.trim().toLocaleLowerCase() === input.personQuery.toLocaleLowerCase(),
  );
  return {
    person: exactPeople.length === 1 ? (exactPeople[0] ?? null) : null,
    candidatePersonIds: people.map((person) => person.id),
    question:
      exactPeople.length > 1
        ? `Which ${input.personQuery} did you mean?`
        : `Who did you mean by ${input.personQuery}?`,
    actions:
      exactPeople.length === 0
        ? ([
            {
              kind: "add_person" as const,
              label: `Add ${input.personQuery}`,
              displayName: input.personQuery,
            },
            { kind: "link_person" as const, label: "Link someone else" as const },
          ] as const)
        : undefined,
  };
}

export function routeDestinationLabel(route: ConversationalCaptureRoute) {
  if (route.destination === "saved_item") return "Saved Items" as const;
  if (route.destination === "followup") return "Follow-Ups" as const;
  if (route.destination === "action") {
    return route.recurrence ? ("Routines" as const) : ("Actions" as const);
  }
  if (route.destination === "person") return "People" as const;
  if (route.destination === "memory") return "Memories" as const;
  if (route.destination === "asset_review") return "Review" as const;
  if (route.destination === "group") return "Grouped" as const;
  return null;
}

export function changeTargetKey(target: ConversationalCaptureChangeTarget) {
  if (target.kind === "edit_saved_item") return `${target.kind}:${target.savedItemId}`;
  if (target.kind === "edit_general_action") return `${target.kind}:${target.generalActionId}`;
  if (target.kind === "edit_followup") return `${target.kind}:${target.followupId}`;
  if (target.kind === "edit_person") return `${target.kind}:${target.personId}`;
  if (target.kind === "edit_memory") return `${target.kind}:${target.memoryId}`;
  return `${target.kind}:${target.groupId}`;
}

export function savedItemConfirmation(input: {
  sourceRecordId: string;
  savedItemId: string;
  kind: SavedItemKind;
  visibilityLabel?: string;
}): ConversationalCaptureConfirmation {
  return {
    destination: "Saved Items",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: { kind: kindLabel(input.kind), visibility: input.visibilityLabel ?? "Only me" },
    change: { kind: "edit_saved_item", savedItemId: input.savedItemId },
    undo: { kind: "archive_saved_item", savedItemId: input.savedItemId },
  };
}

export function actionConfirmation(input: {
  sourceRecordId: string;
  generalActionId: string;
  route: Extract<ConversationalCaptureRoute, { destination: "action" }>;
  visibilityLabel?: string;
}): ConversationalCaptureConfirmation {
  const { route } = input;
  return {
    destination: route.recurrence ? "Routines" : "Actions",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: {
      title: route.title,
      dueAt: route.dueAt?.toISOString() ?? null,
      cadence: route.recurrence
        ? `Every ${route.recurrence.interval} ${route.recurrence.unit}${route.recurrence.interval === 1 ? "" : "s"}`
        : null,
      scope: input.visibilityLabel ?? "Only me",
    },
    change: { kind: "edit_general_action", generalActionId: input.generalActionId },
    undo: { kind: "archive_general_action", generalActionId: input.generalActionId },
  };
}

export function followupConfirmation(input: {
  sourceRecordId: string;
  followupId: string;
  person: ResolvedCapturePerson;
  route: Extract<ConversationalCaptureRoute, { destination: "followup" }>;
  visibilityLabel?: string;
}): ConversationalCaptureConfirmation {
  return {
    destination: "Follow-Ups",
    groundedBySourceRecordId: input.sourceRecordId,
    interpreted: {
      person: input.person.displayName,
      dueAt: input.route.dueAt.toISOString(),
      scope: input.visibilityLabel ?? "Only me",
    },
    change: { kind: "edit_followup", followupId: input.followupId },
    undo: { kind: "archive_followup", followupId: input.followupId },
  };
}
