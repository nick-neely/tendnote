import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  briefMutationOutcome,
  createBriefLifecycle,
  createInMemoryBriefLifecycleStore,
} from "./briefs";
import { createInMemoryMemoryStore, createMemoryCapture, memoryMutationOutcome } from "./memories";
import { accountMutationOutcome, reminderMutationOutcome } from "./reminders";
import { createInMemoryReminderStore } from "./reminders/in-memory-store";
import { createReminderService } from "./reminders/service";

const OWNER = "owner-1";
const memorySource = readFileSync(join(import.meta.dirname, "memories.ts"), "utf8");
const reminderSource = readFileSync(join(import.meta.dirname, "reminders.ts"), "utf8");
const briefSource = readFileSync(join(import.meta.dirname, "briefs.ts"), "utf8");

function exportedFunctionBlock(source: string, name: string) {
  const asyncStart = source.indexOf(`export async function ${name}`);
  const syncStart = source.indexOf(`export function ${name}`);
  const start = asyncStart >= 0 ? asyncStart : syncStart;
  expect(start, `missing exported mutation ${name}`).toBeGreaterThanOrEqual(0);
  const next = source.indexOf("\nexport ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

describe("production mutation outcome wiring", () => {
  it("wraps every public Memory mutation at the Drizzle composition boundary", () => {
    expect(memorySource).toContain("const defaultMemoryStore = createDrizzleMemoryStore()");
    for (const name of [
      "captureExplicitMemory",
      "captureExplicitMemoryFromSource",
      "captureSuggestedMemoryFromSource",
      "saveSuggestedMemory",
      "editSuggestedMemory",
      "dismissSuggestedMemory",
      "archiveMemory",
    ]) {
      expect(exportedFunctionBlock(memorySource, name)).toContain("memoryMutationOutcome(");
    }
    for (const name of [
      "approveExtractedMemoriesForSourceRecord",
      "dismissExtractedMemoriesForSourceRecord",
    ]) {
      expect(exportedFunctionBlock(memorySource, name)).toContain(
        "affectedScopesForOwnerSurfaces(input.ownerUserId)",
      );
    }
  });

  it("wraps every public Reminder and Account mutation at the Drizzle composition boundary", () => {
    expect(reminderSource).toContain("const reminderStore = createDrizzleReminderStore()");
    for (const name of ["saveReminder", "clearReminder", "reconcileReminderRecord"]) {
      expect(exportedFunctionBlock(reminderSource, name)).toContain("reminderMutationOutcome(");
    }
    for (const name of [
      "registerReminderInstallation",
      "setReminderOptInDecision",
      "beginReminderInstallationOptIn",
      "markReminderStandaloneContinuation",
      "claimReminderStandaloneContinuation",
      "setReminderInstallationPreviewMode",
      "disableReminderInstallation",
      "disableCurrentReminderInstallation",
    ]) {
      expect(exportedFunctionBlock(reminderSource, name)).toContain("accountMutationOutcome(");
    }
  });

  it("wraps every public Brief mutation at the Drizzle composition boundary", () => {
    expect(briefSource).toContain(
      "const defaultBriefLifecycleStore = createDrizzleBriefLifecycleStore()",
    );
    expect(exportedFunctionBlock(briefSource, "generateManualBrief")).toContain(
      "affectedScopesForBriefs(input.ownerUserId)",
    );
    for (const name of ["dismissBriefItem", "snoozeBriefItem", "markBriefItemActed"]) {
      expect(exportedFunctionBlock(briefSource, name)).toContain("briefMutationOutcome(");
    }
    const acceptance = exportedFunctionBlock(briefSource, "acceptBriefSuggestedFollowup");
    expect(acceptance).toContain("affectedScopesForBriefs(input.ownerUserId)");
    expect(acceptance).toContain("affectedScopesForOwnerSurfaces(input.ownerUserId)");
  });
});

describe("in-memory mutation outcome behavior", () => {
  it("preserves a committed Memory and carries People, Today, and Review scopes", async () => {
    const store = createInMemoryMemoryStore();
    const person = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Maya",
      firstName: "Maya",
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const capture = createMemoryCapture(store);

    const outcome = await memoryMutationOutcome(
      capture.captureExplicitMemory({
        ownerUserId: OWNER,
        personId: person.id,
        content: "Maya prefers oat milk",
      }),
    );

    expect(outcome.result.memory).toMatchObject({
      ownerUserId: OWNER,
      personId: person.id,
      status: "approved",
    });
    expect(outcome.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "people", ownerUserId: OWNER },
      {
        kind: "viewer-entity",
        entity: "person",
        entityId: person.id,
        viewerUserId: OWNER,
      },
      { kind: "visible-entity", entity: "person", entityId: person.id },
      { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
    ]);
  });

  it("preserves in-memory Reminder and Account writes with their exact scopes", async () => {
    const store = createInMemoryReminderStore();
    const service = createReminderService({
      store,
      loadReminderRecord: vi.fn(async () => ({
        id: "action-1",
        kind: "general_action" as const,
        ownerUserId: OWNER,
        title: "Replace the filter",
        status: "open",
        occursAt: new Date("2026-08-14T00:00:00.000Z"),
        timeSemantics: "date_only" as const,
        recurrence: null,
        sensitivity: "normal" as const,
        scope: "private" as const,
        personId: null,
      })),
    });
    const reminderInput = {
      ownerUserId: OWNER,
      recordKind: "general_action" as const,
      recordId: "action-1",
      clientInstallationId: "browser-1",
      timeZone: "America/Chicago",
      schedule: { kind: "exact" as const, localTime: "09:00" },
      now: new Date("2026-07-21T15:00:00.000Z"),
    };

    const reminder = await reminderMutationOutcome(
      reminderInput,
      service.saveReminder(reminderInput),
    );
    expect(reminder.result.schedule.recordId).toBe("action-1");
    expect(reminder.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
      {
        kind: "viewer-entity",
        entity: "general-action",
        entityId: "action-1",
        viewerUserId: OWNER,
      },
      { kind: "owner-collection", collection: "today", ownerUserId: OWNER },
      { kind: "owner-collection", collection: "review", ownerUserId: OWNER },
    ]);

    const account = await accountMutationOutcome(
      OWNER,
      service.registerReminderInstallation({
        ownerUserId: OWNER,
        clientInstallationId: "browser-1",
        subscription: {
          endpoint: "https://push.example.test/owner-1",
          expirationTime: null,
          keys: { p256dh: "p256dh", auth: "auth" },
        },
        now: new Date("2026-07-21T15:01:00.000Z"),
      }),
    );
    expect(account.result.installation.ownerUserId).toBe(OWNER);
    expect(account.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "account", ownerUserId: OWNER },
    ]);
  });

  it("preserves an in-memory Brief lifecycle result with its Briefs scope", async () => {
    const store = createInMemoryBriefLifecycleStore();
    const lifecycle = createBriefLifecycle(store);
    const person = await store.createPerson({
      ownerUserId: OWNER,
      displayName: "Maya",
      firstName: "Maya",
      lastName: null,
      birthday: null,
      relationshipType: "friend",
      closenessLevel: 3,
      profileBlurb: null,
      source: "manual",
    });
    const brief = await store.createBrief({
      ownerUserId: OWNER,
      cadence: "daily",
      localDate: "2026-07-21",
      generationReason: "manual",
      generatedAt: new Date("2026-07-21T13:00:00.000Z"),
      windowStart: new Date("2026-07-21T00:00:00.000Z"),
      windowEnd: new Date("2026-07-22T00:00:00.000Z"),
      summary: null,
      summaryProvenance: null,
      supersededAt: null,
      items: [
        {
          ownerUserId: OWNER,
          kind: "due_followup",
          personId: person.id,
          personDisplayName: person.displayName,
          title: "Follow up with Maya",
          reason: "Reconnect.",
          dueAt: new Date("2026-07-21T14:00:00.000Z"),
          sourceRefs: [{ kind: "followup", id: "followup-1" }],
          trustLevel: "active_reminder",
          sensitivity: "normal",
          scope: "private",
          householdId: null,
          rank: 1,
          status: "active",
          snoozedUntil: null,
        },
      ],
    });
    const item = brief.items[0];
    if (!item) throw new Error("Expected seeded Brief item.");

    const outcome = await briefMutationOutcome(
      OWNER,
      lifecycle.dismissBriefItem({ ownerUserId: OWNER, briefItemId: item.id }),
    );

    expect(outcome.result.status).toBe("dismissed");
    expect(outcome.affectedScopes).toEqual([
      { kind: "owner-collection", collection: "briefs", ownerUserId: OWNER },
    ]);
  });
});
