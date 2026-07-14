import { describe, expect, it } from "vitest";
import { type ComposeAssetHistoryInput, composeAssetHistory } from "./asset-history";
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

/** Every source, empty by default — a case names only the source it is about. */
function historyInput(overrides: Partial<ComposeAssetHistoryInput> = {}): ComposeAssetHistoryInput {
  return {
    auditEvents: [],
    memories: [],
    evidence: [],
    assetLinks: [],
    personLinks: [],
    actions: [],
    ...overrides,
  };
}

describe("composeAssetHistory", () => {
  it("maps the asset's lifecycle audit events to user-facing entries and drops internal kinds", () => {
    const entries = composeAssetHistory(
      historyInput({
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
      }),
    );

    // Only the asset's own story comes from the trail: added, archived, restored.
    // The child records (memories, evidence, links) tell their own stories from
    // the scope-filtered records below — never from this owner-keyed trail (#202).
    expect(entries.map((entry) => entry.type === "asset" && entry.event)).toEqual([
      "restored",
      "archived",
      "added",
    ]);
  });

  it("reads an accepted proposal's `promoted` audit event as the asset being added", () => {
    const entries = composeAssetHistory(
      historyInput({
        auditEvents: [
          auditEvent({ id: "e1", kind: "suggested", createdAt: new Date("2026-01-01T00:00:00Z") }),
          auditEvent({ id: "e2", kind: "promoted", createdAt: new Date("2026-01-02T00:00:00Z") }),
        ],
      }),
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ type: "asset", event: "added" });
  });

  it("includes each reviewed memory as a detail entry carrying its label", () => {
    const entries = composeAssetHistory(
      historyInput({
        memories: [
          memory({ id: "m1", label: "Filter size", createdAt: new Date("2026-02-01T00:00:00Z") }),
        ],
      }),
    );

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

  it("includes each captured piece of evidence, carrying its kind and label", () => {
    const entries = composeAssetHistory(
      historyInput({
        evidence: [
          {
            id: "ev1",
            kind: "receipt",
            label: "Costco receipt",
            createdAt: new Date("2026-02-02T00:00:00Z"),
          },
        ],
      }),
    );

    expect(entries).toEqual([
      {
        id: "evidence-ev1",
        type: "evidence",
        at: new Date("2026-02-02T00:00:00Z"),
        evidenceId: "ev1",
        kind: "receipt",
        label: "Costco receipt",
      },
    ]);
  });

  it("includes confirmed context links — the asset it was linked to and the person linked to it", () => {
    const entries = composeAssetHistory(
      historyInput({
        assetLinks: [
          {
            linkId: "l1",
            relation: "fits",
            direction: "outgoing",
            otherAsset: { id: "asset-2", name: "Refrigerator" },
            createdAt: new Date("2026-02-03T00:00:00Z"),
          },
        ],
        personLinks: [
          {
            linkId: "p1",
            relation: "recommended",
            person: { id: "person-1", displayName: "Alex Morgan" },
            createdAt: new Date("2026-02-04T00:00:00Z"),
          },
        ],
      }),
    );

    expect(entries).toEqual([
      {
        id: "person-link-p1",
        type: "person-link",
        at: new Date("2026-02-04T00:00:00Z"),
        linkId: "p1",
        personId: "person-1",
        displayName: "Alex Morgan",
        relation: "recommended",
      },
      {
        id: "asset-link-l1",
        type: "asset-link",
        at: new Date("2026-02-03T00:00:00Z"),
        linkId: "l1",
        otherAssetId: "asset-2",
        otherAssetName: "Refrigerator",
        relation: "fits",
        direction: "outgoing",
      },
    ]);
  });

  it("includes linked action lifecycle events with the action's title, keeping the meaningful kinds", () => {
    const entries = composeAssetHistory(
      historyInput({
        actions: [
          {
            action: { id: "action-1", title: "Replace the refrigerator water filter" },
            events: [
              actionEvent({
                id: "a1",
                kind: "created",
                createdAt: new Date("2026-03-01T00:00:00Z"),
              }),
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
              actionEvent({
                id: "a4",
                kind: "paused",
                createdAt: new Date("2026-03-04T00:00:00Z"),
              }),
              actionEvent({
                id: "a5",
                kind: "edited",
                createdAt: new Date("2026-03-05T00:00:00Z"),
              }),
              actionEvent({
                id: "a6",
                kind: "reopened",
                createdAt: new Date("2026-03-06T00:00:00Z"),
              }),
            ],
          },
        ],
      }),
    );

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

  it("merges every source newest first and honors the limit", () => {
    const entries = composeAssetHistory(
      historyInput({
        auditEvents: [
          auditEvent({ id: "e1", kind: "created", createdAt: new Date("2026-01-01T00:00:00Z") }),
        ],
        memories: [
          memory({ id: "m1", label: "Model number", createdAt: new Date("2026-01-03T00:00:00Z") }),
        ],
        evidence: [
          {
            id: "ev1",
            kind: "receipt",
            label: "Costco receipt",
            createdAt: new Date("2026-01-04T00:00:00Z"),
          },
        ],
        personLinks: [
          {
            linkId: "p1",
            relation: "recommended",
            person: { id: "person-1", displayName: "Alex Morgan" },
            createdAt: new Date("2026-01-05T00:00:00Z"),
          },
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
        limit: 3,
      }),
    );

    expect(entries.map((entry) => entry.id)).toEqual([
      "person-link-p1",
      "evidence-ev1",
      "memory-m1",
    ]);
  });
});
