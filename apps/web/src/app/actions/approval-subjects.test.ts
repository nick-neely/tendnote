import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireAdmittedOwnerForActionSpy } from "@/test/action-adapter-mocks";

const { describeApprovalSubject } = vi.hoisted(() => ({
  describeApprovalSubject: vi.fn(),
}));

vi.mock("@tendnote/db/queries/approval-subjects", () => ({ describeApprovalSubject }));

import { describeApprovalSubjectAction } from "./approval-subjects";

const SUBJECT = {
  kind: "described" as const,
  subject: { title: "Accept a follow-up with Mara", lines: ["Reason: check in about the move"] },
};

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmittedOwnerForActionSpy.mockResolvedValue("owner-1");
  describeApprovalSubject.mockResolvedValue(SUBJECT);
});

describe("describeApprovalSubjectAction", () => {
  /**
   * The load-bearing one. The card sends a tool name and a model-authored input; the
   * owner it is described *for* comes only from the session, so a caller cannot aim
   * the lookup at somebody else's scope by supplying an id.
   */
  it("describes the parked call inside the session owner's scope, never a supplied one", async () => {
    await expect(
      describeApprovalSubjectAction({
        toolName: "accept_suggested_followup",
        input: { followupId: "fu-1", ownerUserId: "someone-else" },
      }),
    ).resolves.toEqual({ ok: true, view: SUBJECT });

    expect(describeApprovalSubject).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      toolName: "accept_suggested_followup",
      input: { followupId: "fu-1", ownerUserId: "someone-else" },
    });
  });

  it("passes the registry's own answers through untouched", async () => {
    for (const lookup of [{ kind: "missing" }, { kind: "unknown-tool" }] as const) {
      describeApprovalSubject.mockResolvedValue(lookup);
      await expect(
        describeApprovalSubjectAction({ toolName: "web_fetch", input: { url: "https://x.test" } }),
      ).resolves.toEqual({ ok: true, view: lookup });
    }
  });

  it("describes a call with no arguments at all", async () => {
    await expect(describeApprovalSubjectAction({ toolName: "list_drafts" })).resolves.toMatchObject(
      { ok: true },
    );

    expect(describeApprovalSubject).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      toolName: "list_drafts",
      input: undefined,
    });
  });

  it("refuses a tool name that names no tool, without touching the registry", async () => {
    await expect(describeApprovalSubjectAction({ toolName: "   " })).resolves.toMatchObject({
      ok: false,
    });

    expect(describeApprovalSubject).not.toHaveBeenCalled();
  });

  /**
   * A parked call's input reached the browser as JSON, so that is all this accepts.
   * Anything else is a malformed request rather than a record to look up, and it
   * stops before a describer's own schema ever sees it.
   */
  it("refuses an input that is not plain JSON", async () => {
    await expect(
      describeApprovalSubjectAction({
        toolName: "archive_memory",
        input: { memoryId: "m-1", onDone: () => {} },
      }),
    ).resolves.toMatchObject({ ok: false });

    expect(describeApprovalSubject).not.toHaveBeenCalled();
  });

  it("does not describe anything when the admitted owner gate rejects the caller", async () => {
    requireAdmittedOwnerForActionSpy.mockRejectedValue(new Error("not admitted"));

    await expect(
      describeApprovalSubjectAction({ toolName: "archive_memory", input: { memoryId: "m-1" } }),
    ).rejects.toThrow("not admitted");
    expect(describeApprovalSubject).not.toHaveBeenCalled();
  });
});
