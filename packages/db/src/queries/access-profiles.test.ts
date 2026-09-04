import type { AccessProfile } from "@tendnote/domain";
import { describe, expect, it } from "vitest";
import { createInMemoryAccessProfileStore } from "./access-profiles/in-memory-store";
import { createAccessProfileQueries } from "./access-profiles/queries";

const FIRST_USER = "user-first";
const SECOND_USER = "user-second";

/** A persisted, admitted profile — the explicit local/bootstrap fixture. */
function grantedProfileFixture(userId: string): AccessProfile {
  const now = new Date("2026-06-25T12:00:00.000Z");

  return {
    userId,
    status: "granted",
    source: "bootstrap",
    grantedAt: now,
    selfContextOnboardingStatus: "not_started",
    selfContextOnboardingReminderAt: null,
    householdCheckinEnabled: false,
    eveApprovalMode: "ask",
    createdAt: now,
    updatedAt: now,
  };
}

describe("access profile queries", () => {
  it("starts every new user pending without an arrival-order bootstrap", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const profile = await queries.ensureAccessProfile({ userId: FIRST_USER });

    expect(profile.userId).toBe(FIRST_USER);
    expect(profile.status).toBe("pending");
    expect(profile.source).toBeNull();
    expect(profile.grantedAt).toBeNull();
  });

  it("keeps unrelated signups pending", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const first = await queries.ensureAccessProfile({ userId: FIRST_USER });
    const second = await queries.ensureAccessProfile({ userId: SECOND_USER });

    expect(first.status).toBe("pending");
    expect(second.status).toBe("pending");
    expect(second.source).toBeNull();
    expect(second.grantedAt).toBeNull();
  });

  it("keeps an explicit local-development owner mechanism available", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const profile = await queries.ensureLocalDevelopmentAccessProfile({ userId: FIRST_USER });

    expect(profile.status).toBe("granted");
    expect(profile.source).toBe("bootstrap");
  });

  it("is idempotent and returns the existing profile without re-bootstrapping", async () => {
    const store = createInMemoryAccessProfileStore([grantedProfileFixture(FIRST_USER)]);
    const queries = createAccessProfileQueries(store);

    await queries.ensureAccessProfile({ userId: SECOND_USER });
    const again = await queries.ensureAccessProfile({ userId: SECOND_USER });

    expect(again.userId).toBe(SECOND_USER);
    expect(again.status).toBe("pending");
  });

  it("does not let the old bootstrap insert path elect a production owner", async () => {
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);

    const first = await queries.ensureLocalDevelopmentAccessProfile({ userId: FIRST_USER });
    expect(first.source).toBe("bootstrap");

    // Historical/local bootstrap rows remain constrained, but normal profile
    // creation never attempts that source.
    const second = await store.insertIfAbsent({
      userId: SECOND_USER,
      status: "granted",
      source: "bootstrap",
      grantedAt: new Date(),
    });
    expect(second).toBeNull();

    const settled = await queries.ensureAccessProfile({ userId: SECOND_USER });
    expect(settled.status).toBe("pending");
  });

  it("persists a distinct self-hosted bootstrap source", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const granted = await queries.grantAccess({
      userId: FIRST_USER,
      source: "self_hosted_bootstrap",
    });

    expect(granted.status).toBe("granted");
    expect(granted.source).toBe("self_hosted_bootstrap");
    await expect(queries.checkAccess({ userId: FIRST_USER })).resolves.toMatchObject({
      admitted: true,
      profile: { source: "self_hosted_bootstrap" },
    });
  });

  it("admits a persisted granted user through the shared access-check seam", async () => {
    const queries = createAccessProfileQueries(
      createInMemoryAccessProfileStore([grantedProfileFixture(FIRST_USER)]),
    );

    const decision = await queries.checkAccess({ userId: FIRST_USER });

    expect(decision.admitted).toBe(true);
    expect(decision.status).toBe("granted");
    expect(decision.profile?.userId).toBe(FIRST_USER);
  });

  it("does not admit a pending user and never loads relationship data", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    const pending = await queries.ensureAccessProfile({ userId: SECOND_USER });
    expect(pending.status).toBe("pending");

    const decision = await queries.checkAccess({ userId: SECOND_USER });
    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
  });

  it("lists only granted principals for owner-scoped background work", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureLocalDevelopmentAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    await expect(queries.listAdmittedOwnerUserIds()).resolves.toEqual([FIRST_USER]);
  });

  it("treats an unknown user as pending and not admitted", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    const decision = await queries.checkAccess({ userId: "never-signed-up" });

    expect(decision.admitted).toBe(false);
    expect(decision.status).toBe("pending");
    expect(decision.profile).toBeNull();
  });

  it("durably upgrades a pending user when access is granted", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    const granted = await queries.grantAccess({ userId: SECOND_USER, source: "beta_flag" });
    expect(granted.status).toBe("granted");
    expect(granted.source).toBe("beta_flag");
    expect(granted.grantedAt).toBeInstanceOf(Date);

    const decision = await queries.checkAccess({ userId: SECOND_USER });
    expect(decision.admitted).toBe(true);
  });

  it("stores Self Context setup state as account metadata and claims one later invitation", async () => {
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());
    await queries.ensureAccessProfile({ userId: FIRST_USER });

    await expect(queries.getSelfContextOnboardingState({ userId: FIRST_USER })).resolves.toEqual({
      status: "not_started",
      reminderAt: null,
    });
    await expect(queries.dismissSelfContextOnboarding({ userId: FIRST_USER })).resolves.toEqual({
      status: "dismissed",
      reminderAt: null,
    });

    const [firstClaim, secondClaim] = await Promise.all([
      queries.claimSelfContextOnboardingReminder({ userId: FIRST_USER }),
      queries.claimSelfContextOnboardingReminder({ userId: FIRST_USER }),
    ]);
    expect([firstClaim.claimed, secondClaim.claimed].sort()).toEqual([false, true]);
    expect(firstClaim.state?.reminderAt ?? secondClaim.state?.reminderAt).toBeInstanceOf(Date);

    await expect(
      queries.completeSelfContextOnboarding({ userId: FIRST_USER }),
    ).resolves.toMatchObject({
      status: "completed",
    });
    await expect(
      queries.claimSelfContextOnboardingReminder({ userId: FIRST_USER }),
    ).resolves.toMatchObject({ claimed: false, state: { status: "completed" } });
  });

  it("starts every member without a Household check-in and turns one on for them alone", async () => {
    // Offered, never assumed — and never by anybody else. Two members of one
    // household get two answers, because the opt-in is a fact about a person
    // rather than about the household (ADR 0220).
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);
    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    await expect(queries.getAccessProfile({ userId: FIRST_USER })).resolves.toMatchObject({
      householdCheckinEnabled: false,
    });

    await expect(
      queries.setHouseholdCheckinEnabled({ userId: FIRST_USER, enabled: true }),
    ).resolves.toBe(true);

    await expect(queries.getAccessProfile({ userId: FIRST_USER })).resolves.toMatchObject({
      householdCheckinEnabled: true,
    });
    await expect(queries.getAccessProfile({ userId: SECOND_USER })).resolves.toMatchObject({
      householdCheckinEnabled: false,
    });

    await expect(
      queries.setHouseholdCheckinEnabled({ userId: FIRST_USER, enabled: false }),
    ).resolves.toBe(false);
  });

  it("starts every user in ask Approval Mode and changes one for them alone", async () => {
    // `trusted` is a choice a user makes about their own assistant. Two users
    // get two answers, and neither one sets the other's (#549).
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);
    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });

    await expect(queries.getEveApprovalMode({ userId: FIRST_USER })).resolves.toBe("ask");

    await expect(queries.setEveApprovalMode({ userId: FIRST_USER, mode: "trusted" })).resolves.toBe(
      "trusted",
    );

    await expect(queries.getEveApprovalMode({ userId: FIRST_USER })).resolves.toBe("trusted");
    await expect(queries.getAccessProfile({ userId: FIRST_USER })).resolves.toMatchObject({
      eveApprovalMode: "trusted",
    });
    await expect(queries.getEveApprovalMode({ userId: SECOND_USER })).resolves.toBe("ask");

    await expect(queries.setEveApprovalMode({ userId: FIRST_USER, mode: "ask" })).resolves.toBe(
      "ask",
    );
  });

  it("reads ask for a user with no access profile rather than failing", async () => {
    // The policy reads this on every gated call, and the safe answer to "I do
    // not know this user's Approval Mode" is to park for an Owner Approval.
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await expect(queries.getEveApprovalMode({ userId: FIRST_USER })).resolves.toBe("ask");
  });

  it("refuses to set an Approval Mode for someone with no access profile", async () => {
    // Same rule as the check-in: a control that reports success while writing
    // nothing is worse than one that fails.
    const queries = createAccessProfileQueries(createInMemoryAccessProfileStore());

    await expect(
      queries.setEveApprovalMode({ userId: FIRST_USER, mode: "trusted" }),
    ).rejects.toThrow(/assistant approval mode/i);
  });

  it("refuses to turn a check-in on for someone with no access profile", async () => {
    // The failure the brief-schedule home would have had: a control that reports
    // success while updating nothing. Somebody who is not admitted has no
    // preference to set, and saying so is the honest outcome.
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);

    await expect(
      queries.setHouseholdCheckinEnabled({ userId: "nobody", enabled: true }),
    ).rejects.toThrow();
  });

  it("keeps onboarding metadata isolated between admitted owners", async () => {
    const store = createInMemoryAccessProfileStore();
    const queries = createAccessProfileQueries(store);
    await queries.ensureAccessProfile({ userId: FIRST_USER });
    await queries.ensureAccessProfile({ userId: SECOND_USER });
    await queries.grantAccess({ userId: SECOND_USER, source: "manual_grant" });

    await queries.dismissSelfContextOnboarding({ userId: FIRST_USER });

    await expect(
      queries.getSelfContextOnboardingState({ userId: FIRST_USER }),
    ).resolves.toMatchObject({
      status: "dismissed",
    });
    await expect(
      queries.getSelfContextOnboardingState({ userId: SECOND_USER }),
    ).resolves.toMatchObject({
      status: "not_started",
    });
  });
});
