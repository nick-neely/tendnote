import type { ReminderRecordKind } from "@tendnote/domain/reminders";
import { z } from "zod";

/**
 * Stable data scopes emitted by owner-scoped mutations.
 *
 * The union names data, never framework cache tags or routes. Collection scopes
 * identify either an owner's private projection or a viewer's visibility-filtered
 * projection. Entity scopes identify the viewer-specific record projection.
 * Framework adapters translate these scopes into their own reconciliation effects.
 */
export type AffectedScope =
  | {
      kind: "owner-collection";
      collection:
        | "account"
        | "assets"
        | "briefs"
        | "context-facts"
        | "global-recall"
        | "orientation"
        | "people"
        | "review"
        | "saved-items"
        | "today";
      ownerUserId: string;
    }
  | {
      kind: "viewer-collection";
      collection: "assets" | "general-actions" | "saved-items";
      viewerUserId: string;
    }
  | {
      kind: "viewer-entity";
      entity: "asset" | "general-action" | "person" | "saved-item";
      entityId: string;
      viewerUserId: string;
    }
  | {
      kind: "visible-entity";
      entity: "asset" | "person" | "saved-item";
      entityId: string;
    }
  | {
      kind: "household-collection";
      collection: "assets" | "context-facts" | "saved-items";
      householdId: string;
    }
  | {
      kind: "linked-entity";
      entity: "asset";
      entityId: string;
    };

const boundedScopeIdentifier = z.string().min(1).max(200);

/** Wire-validation for signed background reconciliation requests. */
export const affectedScopeSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("owner-collection"),
      collection: z.enum([
        "account",
        "assets",
        "briefs",
        "context-facts",
        "global-recall",
        "orientation",
        "people",
        "review",
        "saved-items",
        "today",
      ]),
      ownerUserId: boundedScopeIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("viewer-collection"),
      collection: z.enum(["assets", "general-actions", "saved-items"]),
      viewerUserId: boundedScopeIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("viewer-entity"),
      entity: z.enum(["asset", "general-action", "person", "saved-item"]),
      entityId: boundedScopeIdentifier,
      viewerUserId: boundedScopeIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("visible-entity"),
      entity: z.enum(["asset", "person", "saved-item"]),
      entityId: boundedScopeIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("household-collection"),
      collection: z.enum(["assets", "context-facts", "saved-items"]),
      householdId: boundedScopeIdentifier,
    })
    .strict(),
  z
    .object({
      kind: z.literal("linked-entity"),
      entity: z.literal("asset"),
      entityId: boundedScopeIdentifier,
    })
    .strict(),
]);

/** A committed domain result paired with the stable scopes changed by the write. */
export type MutationOutcome<TResult> = {
  result: TResult;
  affectedScopes: AffectedScope[];
};

export function affectedScopesForAccount(ownerUserId: string): AffectedScope[] {
  return [{ kind: "owner-collection", collection: "account", ownerUserId }];
}

function contextFactOwnerScopes(ownerUserId: string): AffectedScope[] {
  return [
    { kind: "owner-collection", collection: "context-facts", ownerUserId },
    { kind: "owner-collection", collection: "orientation", ownerUserId },
    { kind: "owner-collection", collection: "review", ownerUserId },
    { kind: "owner-collection", collection: "global-recall", ownerUserId },
    { kind: "owner-collection", collection: "account", ownerUserId },
  ];
}

export function affectedScopesForContextFact(input: {
  ownerUserId: string;
  householdId?: string | null;
  householdMemberUserIds?: readonly string[];
}): AffectedScope[] {
  const ownerScopes = contextFactOwnerScopes(input.ownerUserId);

  if (!input.householdId) {
    return ownerScopes;
  }

  const otherHouseholdMemberScopes = [...new Set(input.householdMemberUserIds ?? [])]
    .filter((userId) => userId !== input.ownerUserId)
    .flatMap((ownerUserId) => contextFactOwnerScopes(ownerUserId));

  return [
    ...ownerScopes,
    ...otherHouseholdMemberScopes,
    {
      kind: "household-collection",
      collection: "context-facts",
      householdId: input.householdId,
    },
  ];
}

export function affectedScopesForBriefs(ownerUserId: string): AffectedScope[] {
  return [{ kind: "owner-collection", collection: "briefs", ownerUserId }];
}

export function affectedScopesForOwnerSurfaces(ownerUserId: string): AffectedScope[] {
  return [
    { kind: "owner-collection", collection: "today", ownerUserId },
    { kind: "owner-collection", collection: "review", ownerUserId },
  ];
}

export function affectedScopesForReminder(input: {
  ownerUserId: string;
  recordKind: ReminderRecordKind;
  recordId: string;
}): AffectedScope[] {
  const entity =
    input.recordKind === "general_action" || input.recordKind === "routine"
      ? "general-action"
      : input.recordKind === "saved_item"
        ? "saved-item"
        : null;
  return [
    ...affectedScopesForAccount(input.ownerUserId),
    ...(entity
      ? ([
          {
            kind: "viewer-entity",
            entity,
            entityId: input.recordId,
            viewerUserId: input.ownerUserId,
          },
        ] satisfies AffectedScope[])
      : []),
    ...affectedScopesForOwnerSurfaces(input.ownerUserId),
  ];
}
