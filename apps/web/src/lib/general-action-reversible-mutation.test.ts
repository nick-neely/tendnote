import { beforeEach, describe, expect, it, vi } from "vitest";
import { generalActionViewFixture } from "@/components/general-action-fixtures";

vi.mock("@/app/actions/general-actions", () => ({
  archiveGeneralActionAction: vi.fn(),
  completeGeneralActionAction: vi.fn(),
  deferGeneralActionAction: vi.fn(),
  dismissGeneralActionAction: vi.fn(),
  pauseGeneralActionAction: vi.fn(),
  reopenGeneralActionAction: vi.fn(),
  restoreGeneralActionAction: vi.fn(),
  resumeGeneralActionAction: vi.fn(),
  undeferGeneralActionAction: vi.fn(),
  undoRoutineOccurrenceAction: vi.fn(),
}));

import {
  completeGeneralActionAction,
  deferGeneralActionAction,
  dismissGeneralActionAction,
  restoreGeneralActionAction,
  undeferGeneralActionAction,
  undoRoutineOccurrenceAction,
} from "@/app/actions/general-actions";
import {
  generalActionDeferAdapter,
  generalActionLifecycleAdapter,
  routineOccurrenceInverse,
} from "@/lib/general-action-reversible-mutation";

beforeEach(() => {
  vi.resetAllMocks();
});

describe("General Action reversible mutation adapters", () => {
  it("projects deferral without losing the authoritative prior view", () => {
    const prior = generalActionViewFixture({ status: "open" });
    const adapter = generalActionDeferAdapter("2026-08-21", "Set aside until Aug 21");

    expect(adapter.project(prior)).toMatchObject({
      id: prior.id,
      status: "deferred",
      deferUntilDate: "2026-08-21",
      deferUntilISO: "2026-08-21T00:00:00.000Z",
      surfaceLabel: "Set aside until Aug 21",
    });
    expect(prior.status).toBe("open");
  });

  it("restores the exact prior deferred date when a re-deferral is undone", async () => {
    const prior = generalActionViewFixture({
      status: "deferred",
      deferUntilDate: "2026-08-14",
      deferUntilISO: "2026-08-14T00:00:00.000Z",
    });
    vi.mocked(deferGeneralActionAction).mockResolvedValue({ ok: true, view: prior });

    await generalActionDeferAdapter("2026-08-21", "Set aside until Aug 21").inverse(
      prior,
      generalActionViewFixture({
        status: "deferred",
        deferUntilDate: "2026-08-21",
      }),
    );

    expect(deferGeneralActionAction).toHaveBeenCalledWith({
      deferUntil: "2026-08-14",
      generalActionId: prior.id,
    });
    expect(undeferGeneralActionAction).not.toHaveBeenCalled();
  });

  it.each([
    ["completed", completeGeneralActionAction],
    ["dismissed", dismissGeneralActionAction],
  ] as const)("uses the prior %s state as the authoritative inverse of reopen", async (status, inverse) => {
    const prior = generalActionViewFixture({ status });
    vi.mocked(inverse).mockResolvedValue({ ok: true, view: prior });

    await generalActionLifecycleAdapter("reopen").inverse(
      prior,
      generalActionViewFixture({ status: "open" }),
    );

    expect(inverse).toHaveBeenCalledWith({ generalActionId: prior.id });
  });

  it("restores an archived action through the server lifecycle", async () => {
    const prior = generalActionViewFixture({ status: "paused" });
    vi.mocked(restoreGeneralActionAction).mockResolvedValue({ ok: true, view: prior });

    await generalActionLifecycleAdapter("archive").inverse(
      prior,
      generalActionViewFixture({ status: "archived" }),
    );

    expect(restoreGeneralActionAction).toHaveBeenCalledWith({
      generalActionId: prior.id,
    });
  });

  it("serializes Routine undo from the server-owned next occurrence", async () => {
    const prior = generalActionViewFixture({
      dueAtISO: "2026-08-14T00:00:00.000Z",
      dueAtDate: "2026-08-14",
    });
    const authoritative = {
      ...prior,
      revision: "2",
      dueAtISO: "2026-08-21T00:00:00.000Z",
      dueAtDate: "2026-08-21",
    };
    vi.mocked(undoRoutineOccurrenceAction).mockResolvedValue({ ok: true, view: prior });

    await routineOccurrenceInverse(prior)(authoritative);

    expect(undoRoutineOccurrenceAction).toHaveBeenCalledWith({
      expectedDueAt: authoritative.dueAtISO,
      generalActionId: prior.id,
      restoreDueAt: prior.dueAtISO,
    });
  });
});
