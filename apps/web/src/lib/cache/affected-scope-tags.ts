import type { AffectedScope } from "@tendnote/db/queries/general-actions";

/**
 * The one cache-tag vocabulary for both reads and writes.
 *
 * Cache reads describe the data scopes they contain and attach the resulting
 * tags. Reconciliation accepts those same scopes and expires the same tags.
 */
export function tagsForAffectedScope(scope: AffectedScope): readonly string[] {
  if (scope.kind === "owner-collection") {
    return tagsForOwnerCollection(scope);
  }
  if (scope.kind === "viewer-collection") {
    return tagsForViewerCollection(scope);
  }
  if (scope.kind === "viewer-entity") {
    return [viewerEntityTag(scope)];
  }
  if (scope.kind === "visible-entity") {
    return [visibleEntityTag(scope)];
  }
  if (scope.kind === "household-collection") {
    return [householdCollectionTag(scope)];
  }
  return [`action:linked-asset:${scope.entityId}`];
}

export function tagsForAffectedScopes(scopes: readonly AffectedScope[]): readonly string[] {
  return [...new Set(scopes.flatMap(tagsForAffectedScope))];
}

export function tagForAffectedScope(scope: AffectedScope): string {
  const [tag] = tagsForAffectedScope(scope);
  if (!tag) throw new Error(`Affected scope has no cache tag: ${JSON.stringify(scope)}`);
  return tag;
}

function tagsForOwnerCollection(
  scope: Extract<AffectedScope, { kind: "owner-collection" }>,
): readonly string[] {
  const ownerUserId = scope.ownerUserId;
  if (scope.collection === "account") return [`account:owner:${ownerUserId}`];
  if (scope.collection === "briefs") return [`briefs:owner:${ownerUserId}`];
  if (scope.collection === "assets") {
    return [`asset:viewer:${ownerUserId}`, `asset:viewer:${ownerUserId}:collection`];
  }
  if (scope.collection === "people") {
    return [`people:owner:${ownerUserId}`, `people:owner:${ownerUserId}:list`];
  }
  if (scope.collection === "review") {
    return [`review:owner:${ownerUserId}`, `review:owner:${ownerUserId}:queue`];
  }
  if (scope.collection === "context-facts") {
    return [`context-facts:owner:${ownerUserId}`];
  }
  if (scope.collection === "orientation") {
    return [`orientation:owner:${ownerUserId}`];
  }
  if (scope.collection === "global-recall") {
    return [`global-recall:owner:${ownerUserId}`];
  }
  if (scope.collection === "saved-items") {
    return [
      `saved-item:viewer:${ownerUserId}`,
      `saved-item:viewer:${ownerUserId}:collection`,
      `saved-item:viewer:${ownerUserId}:reminders`,
    ];
  }
  return [`today:owner:${ownerUserId}`, `today:owner:${ownerUserId}:shortlist`];
}

function tagsForViewerCollection(
  scope: Extract<AffectedScope, { kind: "viewer-collection" }>,
): readonly string[] {
  const viewerUserId = scope.viewerUserId;
  if (scope.collection === "general-actions") {
    return [`action:owner:${viewerUserId}`, `action:owner:${viewerUserId}:linked-assets`];
  }
  const family = scope.collection === "assets" ? "asset" : "saved-item";
  const tags = [`${family}:viewer:${viewerUserId}`, `${family}:viewer:${viewerUserId}:collection`];
  return scope.collection === "saved-items"
    ? [...tags, `saved-item:viewer:${viewerUserId}:reminders`]
    : tags;
}

function viewerEntityTag(scope: Extract<AffectedScope, { kind: "viewer-entity" }>): string {
  if (scope.entity === "general-action") {
    return `action:owner:${scope.viewerUserId}:action:${scope.entityId}`;
  }
  if (scope.entity === "person") {
    return `people:owner:${scope.viewerUserId}:person:${scope.entityId}`;
  }
  const family = scope.entity === "asset" ? "asset" : "saved-item";
  const record = scope.entity === "asset" ? "asset" : "item";
  return `${family}:viewer:${scope.viewerUserId}:${record}:${scope.entityId}`;
}

function visibleEntityTag(scope: Extract<AffectedScope, { kind: "visible-entity" }>): string {
  if (scope.entity === "person") return `people:visible-person:${scope.entityId}`;
  const family = scope.entity === "asset" ? "asset" : "saved-item";
  const record = scope.entity === "asset" ? "asset" : "item";
  return `${family}:visible:${record}:${scope.entityId}`;
}

function householdCollectionTag(
  scope: Extract<AffectedScope, { kind: "household-collection" }>,
): string {
  const family = scope.collection === "assets" ? "asset" : "saved-item";
  return `${family}:household:${scope.householdId}:collection`;
}
