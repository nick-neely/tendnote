import { describe, expect, it } from "vitest";
import { composeAssetHistory } from "./asset-history";
import type { AssetAuditEvent } from "./assets";
import type { GeneralActionEvent } from "./general-actions";

const OWNER = "user-1";
const ASSET = "asset-1";

function auditEvent(
  overrides: Partial<AssetAuditEvent> & Pick<AssetAuditEvent, "id" | "kind" | "createdAt">,
): AssetAuditEvent {
  return {
    assetId: ASSET,
    ownerUserId: OWNER,
    actorUserId: OWNER,
    source: "user",
    scope: "private",
    detailJson: {},
    ...overrides,
  };
}

function actionEvent(
  overrides: Partial<GeneralActionEvent> & Pick<GeneralActionEvent, "id" | "kind" | "createdAt">,
): GeneralActionEvent {
  return {
    generalActionId: "action-1",
    ownerUserId: OWNER,
    actorUserId: OWNER,
    detailJson: {},
    ...overrides,
  };
}

function memory(overrides: { id: string; label: string; createdAt: Date }) {
  return overrides;
}

describe("composeAssetHistory", () => {
  it("maps the asset's lifecycle audit events to user-facing entries and drops internal kinds", () => {
    const entries = composeAssetHistory({
      auditEvents: [
        auditEvent({ id: "e1", kind: "created", createdAt: new Date("2026-01-01T00:00:00Z") }),
        auditEvent({ id: "e2", kind: "edited", createdAt: new Date("2026-01-02T00:00:00Z") }),
        auditEvent({
          id: "e3",
          kind: "memory_suggested",
          createdAt: new Date("2026-01-03T00:00:00Z"),
        }),
        auditEvent({
          id: "e4",
          kind: "evidence_added",
          createdAt: new Date("2026-01-04T00:00:00Z"),
        }),
        auditEvent({ id: "e5", kind: "archived", createdAt: new Date("2026-01-05T00:00:00Z") }),
        auditEvent({ id: "e6", kind: "restored", createdAt: new Date("2026-01-06T00:00:00Z") }),
      ],
      memories: [],
      actions: [],
    });

    // Only the asset's own story: added, archived, restored — internal audit
    // detail (edits, memory/evidence writes) stays internal (#196).
    expect(entries.map((entry) => entry.type === "asset" && entry.event)).toEqual([
      "restored",
      "archived",
      "added",
    ]);
  });

  it("reads an accepted proposal's `promoted` audit event as the asset being added", () => {
    const entries = composeAssetHistory({
      auditEvents: [
        auditEvent({ id: "e1", kind: "suggested", createdAt: new Date("2026-01-01T00:00:00Z") }),
        auditEvent({ id: "e2", kind: "promoted", createdAt: new Date("2026-01-02T00:00:00Z") }),
      ],
      memories: [],
      actions: [],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "asset", event: "added" });
  });

  it("includes each reviewed memory as a detail entry carrying its label", () => {
    const entries = composeAssetHistory({
      auditEvents: [],
      memories: [
        memory({ id: "m1", label: "Filter size", createdAt: new Date("2026-02-01T00:00:00Z") }),
      ],
      actions: [],
    });

    expect(entries).toEqual([
      {
        id: "memory-m1",
        type: "memory",
        at: new Date("2026-02-01T00:00:00Z"),
        memoryId: "m1",
        label: "Filter size",
      },
    ]);
  });

  it("includes linked action lifecycle events with the action's title, keeping the meaningful kinds", () => {
    const entries = composeAssetHistory({
      auditEvents: [],
      memories: [],
      actions: [
        {
          action: { id: "action-1", title: "Replace the refrigerator water filter" },
          events: [
            actionEvent({ id: "a1", kind: "created", createdAt: new Date("2026-03-01T00:00:00Z") }),
            actionEvent({
              id: "a2",
              kind: "completed",
              createdAt: new Date("2026-03-02T00:00:00Z"),
            }),
            // Deferred/paused/edited churn stays on the action's own history.
            actionEvent({
              id: "a3",
              kind: "deferred",
              createdAt: new Date("2026-03-03T00:00:00Z"),
            }),
            actionEvent({ id: "a4", kind: "paused", createdAt: new Date("2026-03-04T00:00:00Z") }),
            actionEvent({ id: "a5", kind: "edited", createdAt: new Date("2026-03-05T00:00:00Z") }),
            actionEvent({
              id: "a6",
              kind: "reopened",
              createdAt: new Date("2026-03-06T00:00:00Z"),
            }),
          ],
        },
      ],
    });

    expect(entries).toEqual([
      {
        id: "action-a6",
        type: "action",
        at: new Date("2026-03-06T00:00:00Z"),
        actionId: "action-1",
        actionTitle: "Replace the refrigerator water filter",
        event: "reopened",
      },
      {
        id: "action-a2",
        type: "action",
        at: new Date("2026-03-02T00:00:00Z"),
        actionId: "action-1",
        actionTitle: "Replace the refrigerator water filter",
        event: "completed",
      },
      {
        id: "action-a1",
        type: "action",
        at: new Date("2026-03-01T00:00:00Z"),
        actionId: "action-1",
        actionTitle: "Replace the refrigerator water filter",
        event: "created",
      },
    ]);
  });

  it("merges all three sources newest first and honors the limit", () => {
    const entries = composeAssetHistory({
      auditEvents: [
        auditEvent({ id: "e1", kind: "created", createdAt: new Date("2026-01-01T00:00:00Z") }),
      ],
      memories: [
        memory({ id: "m1", label: "Model number", createdAt: new Date("2026-01-03T00:00:00Z") }),
      ],
      actions: [
        {
          action: { id: "action-1", title: "Replace filter" },
          events: [
            actionEvent({
              id: "a1",
              kind: "completed",
              createdAt: new Date("2026-01-02T00:00:00Z"),
            }),
          ],
        },
      ],
      limit: 2,
    });

    expect(entries.map((entry) => entry.id)).toEqual(["memory-m1", "action-a1"]);
  });
});
