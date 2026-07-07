import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInMemoryFollowupLifecycleStore } from "./in-memory-store";
import { createFollowupLifecycle } from "./lifecycle";
import { createSuggestedFollowupReview } from "./review";

/**
 * Phase 1E boundary regression coverage (issue #50). These prove the settled
 * lifecycle boundary holds across the active and suggested paths together: inert
 * cadence (no recurrence), concrete due dates only, restricted-content exclusion,
 * review-gating, and that dismissed/archived records leave the active and review
 * feeds. The structural test at the end proves the follow-up layer takes on no
 * agenda, brief, calendar, contacts, external-send, or shared-household behavior.
 */
const OWNER = "user-1";

async function setup() {
  const store = createInMemoryFollowupLifecycleStore();
  const lifecycle = createFollowupLifecycle(store);
  const review = createSuggestedFollowupReview(store);

  const person = await store.createPerson({
    ownerUserId: OWNER,
    displayName: "Mark",
    firstName: null,
    lastName: null,
    birthday: null,
    relationshipType: "friend",
    closenessLevel: 3,
    profileBlurb: null,
    source: "manual",
  });

  async function seedSource(sensitivity: "normal" | "sensitive" | "restricted" = "normal") {
    return store.createSourceRecord({
      ownerUserId: OWNER,
      sourceType: "manual",
      content: "Context about Mark.",
      rawContent: null,
      retentionPolicy: "retain",
      status: "active",
      confidence: "medium",
      sensitivity,
      scope: "private",
      importance: 3,
      metadataJson: {},
    });
  }

  const dueAt = new Date("2026-07-15T00:00:00Z");
  const activeCount = async () =>
    (await store.listActiveFollowupsForOwner({ ownerUserId: OWNER })).length;
  const reviewCount = async () =>
    (await review.listSuggestedFollowupReviews({ ownerUserId: OWNER })).length;

  return { store, lifecycle, review, person, seedSource, dueAt, activeCount, reviewCount };
}

describe("cadence stays inert — no automatic recurrence", () => {
  it("does not generate a next instance on snooze, edit, or complete", async () => {
    const { store, lifecycle, person, dueAt } = await setup();
    const countForPerson = async () =>
      (await store.listFollowupsForPerson({ ownerUserId: OWNER, personId: person.id })).length;

    const followup = await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Weekly check-in.",
      dueAt,
      cadence: "weekly",
    });
    await lifecycle.snoozeFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
      dueAt: new Date("2026-07-22T00:00:00Z"),
    });
    await lifecycle.editFollowup({
      actorUserId: OWNER,
      followupId: followup.id,
      edit: { reason: "Weekly check-in (updated)." },
    });
    await lifecycle.completeFollowup({ actorUserId: OWNER, followupId: followup.id });

    // Exactly one record ever existed — no recurrence spawned a sibling.
    expect(await countForPerson()).toBe(1);
  });
});

describe("concrete due dates only — no vague someday reminders", () => {
  it("rejects vague timing for active follow-ups", async () => {
    const { lifecycle, person } = await setup();

    await expect(
      lifecycle.createFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Someday.",
        dueAt: new Date("not a date"),
      }),
    ).rejects.toThrow(/concrete due date/);
  });

  it("rejects vague timing for suggested follow-ups", async () => {
    const { review, person, seedSource } = await setup();
    const source = await seedSource();

    await expect(
      review.suggestFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Someday.",
        dueAt: new Date("not a date"),
        sourceRecordId: source.id,
      }),
    ).rejects.toThrow(/concrete due date/);
  });
});

describe("restricted content is not proactively suggested by default", () => {
  it("refuses restricted grounding unless directly requested", async () => {
    const { review, person, seedSource, dueAt } = await setup();
    const restricted = await seedSource("restricted");

    await expect(
      review.suggestFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Sensitive.",
        dueAt,
        sourceRecordId: restricted.id,
      }),
    ).rejects.toThrow(/Restricted context/);

    await expect(
      review.suggestFollowup({
        ownerUserId: OWNER,
        personId: person.id,
        reason: "Sensitive.",
        dueAt,
        sourceRecordId: restricted.id,
        directlyRequested: true,
      }),
    ).resolves.toMatchObject({ followup: { status: "suggested" } });
  });
});

describe("suggested follow-ups never become active without explicit acceptance", () => {
  it("stays out of the active feed until accepted, then promotes", async () => {
    const { review, person, seedSource, dueAt, activeCount } = await setup();
    const source = await seedSource();
    const { followup } = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Check in.",
      dueAt,
      sourceRecordId: source.id,
    });

    expect(await activeCount()).toBe(0);

    await review.acceptSuggestedFollowup({ actorUserId: OWNER, followupId: followup.id });

    expect(await activeCount()).toBe(1);
  });
});

describe("dismissed and archived follow-ups leave the active and review feeds", () => {
  it("removes a dismissed active follow-up from the active feed", async () => {
    const { lifecycle, person, dueAt, activeCount } = await setup();
    const open = await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Active.",
      dueAt,
    });

    await lifecycle.dismissFollowup({ actorUserId: OWNER, followupId: open.id });

    expect(await activeCount()).toBe(0);
  });

  it("removes an archived active follow-up from the active feed", async () => {
    const { lifecycle, person, dueAt, activeCount } = await setup();
    const open = await lifecycle.createFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Active.",
      dueAt,
    });

    await lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: open.id });

    expect(await activeCount()).toBe(0);
  });

  it("removes a dismissed suggestion from the review feed and never activates it", async () => {
    const { review, person, seedSource, dueAt, activeCount, reviewCount } = await setup();
    const source = await seedSource();
    const { followup } = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Tentative.",
      dueAt,
      sourceRecordId: source.id,
    });

    await review.dismissSuggestedFollowup({ actorUserId: OWNER, followupId: followup.id });

    expect(await reviewCount()).toBe(0);
    expect(await activeCount()).toBe(0);
  });

  it("removes an archived suggestion from the review feed and never activates it", async () => {
    const { lifecycle, review, person, seedSource, dueAt, activeCount, reviewCount } =
      await setup();
    const source = await seedSource();
    const { followup } = await review.suggestFollowup({
      ownerUserId: OWNER,
      personId: person.id,
      reason: "Tentative.",
      dueAt,
      sourceRecordId: source.id,
    });

    await lifecycle.archiveFollowup({ actorUserId: OWNER, followupId: followup.id });

    expect(await reviewCount()).toBe(0);
    expect(await activeCount()).toBe(0);
  });
});

describe("no agenda, brief, or external-provider behavior in the follow-up layer", () => {
  it("the follow-up source files import nothing out of scope", () => {
    const sourceFiles = readdirSync(import.meta.dirname).filter(
      (file) => file.endsWith(".ts") && !file.endsWith(".test.ts"),
    );

    // Follow-ups must not reach into relationship agenda ranking, daily briefs,
    // Calendar/Gmail/Contacts, non-person general actions, or external
    // drafts/sends. Phase 4 is allowed to import household scope primitives for
    // the shared person/relationship Follow-Up proof artifact (#162). Scan import
    // specifiers — not prose — so a comment that discusses the boundary cannot
    // false-positive.
    const forbiddenModule = /(agenda|brief|calendar|gmail|contacts|draft|outreach)/i;

    expect(sourceFiles.length).toBeGreaterThan(0);
    for (const file of sourceFiles) {
      const source = readFileSync(join(import.meta.dirname, file), "utf8");
      const specifiers = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
      for (const specifier of specifiers) {
        expect(specifier).not.toMatch(forbiddenModule);
      }
    }
  });
});
