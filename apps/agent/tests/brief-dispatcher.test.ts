import { BACKGROUND_PASS_CRON } from "@tendnote/domain/background-pass";
import { beforeEach, describe, expect, it, vi } from "vitest";
import webConfig from "../../web/vercel.json";
import schedule from "../agent/schedules/brief-dispatcher";

const mocks = vi.hoisted(() => ({
  owners: vi.fn(),
  bootstrap: vi.fn(),
  briefs: vi.fn(),
  aftercare: vi.fn(),
  birthdays: vi.fn(),
  actions: vi.fn(),
  paused: vi.fn(),
}));

vi.mock("eve/schedules", () => ({ defineSchedule: (definition: unknown) => definition }));
vi.mock("@tendnote/db/queries/access-profiles", () => ({
  listAdmittedOwnerUserIds: mocks.owners,
}));
vi.mock("@tendnote/db/queries/brief-schedules", () => ({
  dispatchDueBriefs: mocks.briefs,
  ensureDefaultBriefSchedulesForOwner: mocks.bootstrap,
}));
vi.mock("@tendnote/db/queries/post-meeting-aftercare", () => ({
  dispatchPostMeetingAftercare: mocks.aftercare,
}));
vi.mock("@tendnote/db/queries/birthday-gift-planning", () => ({
  dispatchBirthdayGiftPlanning: mocks.birthdays,
}));
vi.mock("@tendnote/db/queries/action-summary", () => ({ dispatchActionSummary: mocks.actions }));
vi.mock("../agent/lib/schedule-owners", () => ({
  resolveScheduledOwnerUserIds: ({
    listAdmittedOwnerUserIds,
  }: {
    listAdmittedOwnerUserIds: typeof mocks.owners;
  }) => listAdmittedOwnerUserIds(),
}));
vi.mock("../agent/lib/scheduled-delivery-pause", () => ({
  createScheduledDeliveryPause: () => mocks.paused,
}));
vi.mock("../agent/channels/discord", () => ({
  createDiscordProactiveDeliverySender: () => undefined,
}));
vi.mock("../agent/lib/calendar", () => ({ createOwnerCalendarReader: vi.fn() }));

async function tick() {
  const pending: Promise<unknown>[] = [];
  schedule.run?.({
    waitUntil: (task) => {
      pending.push(task);
    },
    to: vi.fn(),
    appAuth: {
      attributes: {},
      authenticator: "app",
      principalId: "eve:app",
      principalType: "runtime",
    },
  });
  await Promise.all(pending);
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.owners.mockResolvedValue(["owner-a", "owner-b"]);
  mocks.bootstrap.mockResolvedValue(undefined);
  mocks.briefs.mockResolvedValue({ claimed: 0 });
  mocks.aftercare.mockResolvedValue(undefined);
  mocks.birthdays.mockResolvedValue(undefined);
  mocks.actions.mockResolvedValue(undefined);
  mocks.paused.mockResolvedValue(false);
});

describe("scheduled workflow cadence", () => {
  it("shares every tick with recovery on the background pass cadence", () => {
    const recovery = webConfig.crons.find((cron) => cron.path === "/api/cron/background-jobs");
    expect(recovery?.schedule).toBe(BACKGROUND_PASS_CRON);
    expect(schedule.cron).toBe(recovery?.schedule);
  });

  it("checks due rows but launches no owner workflows when there are no admitted owners", async () => {
    mocks.owners.mockResolvedValue([]);
    await tick();
    expect(mocks.briefs).toHaveBeenCalledOnce();
    expect(mocks.bootstrap).not.toHaveBeenCalled();
    expect(mocks.aftercare).not.toHaveBeenCalled();
    expect(mocks.birthdays).not.toHaveBeenCalled();
    expect(mocks.actions).not.toHaveBeenCalled();
  });

  it("dispatches admitted owners with a retry hold rather than a larger attempt budget", async () => {
    await tick();
    expect(mocks.bootstrap).toHaveBeenCalledTimes(2);
    expect(mocks.briefs).toHaveBeenCalledWith(expect.objectContaining({ retryDelayMs: 900_000 }));
    expect(mocks.briefs.mock.calls[0]?.[0]).not.toHaveProperty("maxAttempts");
    for (const ownerUserId of ["owner-a", "owner-b"]) {
      expect(mocks.aftercare).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId }));
      expect(mocks.birthdays).toHaveBeenCalledWith(
        expect.objectContaining({ ownerUserId, retryDelayMs: 900_000 }),
      );
      expect(mocks.actions).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId }));
    }
  });

  it("preserves usage pauses for briefs and aftercare without shedding deterministic work", async () => {
    mocks.paused.mockImplementation(async (ownerUserId) => ownerUserId === "owner-a");
    await tick();
    const options = mocks.briefs.mock.calls[0]?.[0];
    await expect(options.skipOwner("owner-a")).resolves.toBe(true);
    await expect(options.skipOwner("owner-b")).resolves.toBe(false);
    expect(mocks.aftercare).toHaveBeenCalledTimes(1);
    expect(mocks.aftercare).toHaveBeenCalledWith(
      expect.objectContaining({ ownerUserId: "owner-b" }),
    );
    expect(mocks.birthdays).toHaveBeenCalledTimes(2);
    expect(mocks.actions).toHaveBeenCalledTimes(2);
  });

  it("isolates workflow failures so another owner and the other families still dispatch", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.briefs.mockRejectedValue(new Error("brief failure"));
    mocks.aftercare.mockRejectedValueOnce(new Error("calendar failure"));
    mocks.birthdays.mockRejectedValueOnce(new Error("birthday failure"));
    mocks.actions.mockRejectedValueOnce(new Error("action failure"));
    try {
      await tick();
      expect(mocks.aftercare).toHaveBeenCalledTimes(2);
      expect(mocks.birthdays).toHaveBeenCalledTimes(2);
      expect(mocks.actions).toHaveBeenCalledTimes(2);
      expect(log).toHaveBeenCalledTimes(4);
    } finally {
      log.mockRestore();
    }
  });
});
