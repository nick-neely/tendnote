import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getDraft } = vi.hoisted(() => ({ getDraft: vi.fn() }));
const { listPersonEmailContactMethods } = vi.hoisted(() => ({
  listPersonEmailContactMethods: vi.fn(),
}));
const { listGmailDraftActionsForDraft, createGmailDraft, updateGmailDraft, approvalGate } =
  vi.hoisted(() => ({
    listGmailDraftActionsForDraft: vi.fn(),
    createGmailDraft: vi.fn(),
    updateGmailDraft: vi.fn(),
    approvalGate: vi.fn(),
  }));

vi.mock("@tendnote/db/queries/drafts", () => ({ getDraft }));
vi.mock("@tendnote/db/queries/contact-methods", () => ({ listPersonEmailContactMethods }));
vi.mock("@tendnote/db/queries/gmail-drafts", () => ({
  // The tool must compose the SHARED gate + SHARED service (ADR-0092) — these are the
  // real production factories, stubbed here to assert the tool wires them.
  createDefaultGmailApprovalGate: () => approvalGate,
  createDefaultGoogleGmailDraftService: () => ({ createGmailDraft, updateGmailDraft }),
  listGmailDraftActionsForDraft,
}));

const { default: tool } = await import("../tools/save_draft_to_gmail");

const DRAFT_ID = "22222222-2222-2222-2222-222222222222";
const ctx = { session: { auth: { current: { principalId: "user-1" } } } } as never;

function input(overrides: Record<string, unknown> = {}) {
  return {
    draftId: DRAFT_ID,
    recipientEmail: "casey@example.com",
    subject: "Checking in",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  getDraft.mockResolvedValue({ id: DRAFT_ID, personId: "p1", status: "approved", body: "Body" });
  listPersonEmailContactMethods.mockResolvedValue([]);
  listGmailDraftActionsForDraft.mockResolvedValue([]);
  createGmailDraft.mockResolvedValue({
    status: "succeeded",
    action: { id: "act-1", kind: "create", gmailDraftId: "g1" },
  });
  updateGmailDraft.mockResolvedValue({
    status: "succeeded",
    action: { id: "act-2", kind: "update", gmailDraftId: "g1" },
  });
});

describe("save_draft_to_gmail tool", () => {
  it("creates through the shared service, owner-scoped, from an approved draft", async () => {
    const result = await tool.execute(input(), ctx);

    expect(result.written).toBe(true);
    expect(createGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: "user-1",
        messageDraftId: DRAFT_ID,
        idempotencyKey: `create:${DRAFT_ID}`,
        recipient: { email: "casey@example.com", source: "manual_entry", contactMethodId: null },
      }),
    );
  });

  it("refuses when there is no Tendnote draft (never drafts from raw context)", async () => {
    getDraft.mockResolvedValue(null);
    const result = await tool.execute(input(), ctx);
    expect(result.written).toBe(false);
    if (result.written) return;
    expect(result.reason).toBe("draft_not_found");
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("surfaces the shared gate's block (not connected) without claiming anything saved", async () => {
    createGmailDraft.mockResolvedValue({ status: "blocked", reason: "Gmail isn't connected." });
    const result = await tool.execute(input(), ctx);
    expect(result.written).toBe(false);
    if (result.written) return;
    expect(result.reason).toBe("blocked");
    expect(result.guidance).toMatch(/connect/i);
    expect(JSON.stringify(result).toLowerCase()).not.toContain("sent");
  });

  it("surfaces the shared gate's block (draft not approved)", async () => {
    createGmailDraft.mockResolvedValue({
      status: "blocked",
      reason: "Approve the Tendnote draft before saving it to Gmail.",
    });
    const result = await tool.execute(input(), ctx);
    if (result.written) throw new Error("expected blocked");
    expect(result.guidance).toMatch(/approve/i);
  });

  it("reports a failed write as a retryable, non-automatic failure", async () => {
    createGmailDraft.mockResolvedValue({ status: "failed", action: { id: "a", kind: "create" } });
    const result = await tool.execute(input(), ctx);
    if (result.written) throw new Error("expected failed");
    expect(result.reason).toBe("failed");
    expect(result.guidance).toMatch(/retry/i);
  });

  it("updates the existing Gmail draft when one is already linked (no duplicate)", async () => {
    listGmailDraftActionsForDraft.mockResolvedValue([
      { status: "succeeded", gmailDraftId: "g1", kind: "create" },
    ]);
    await tool.execute(input({ subject: "Revised" }), ctx);
    expect(updateGmailDraft).toHaveBeenCalled();
    expect(createGmailDraft).not.toHaveBeenCalled();
  });

  it("reuses a saved contact method when the confirmed address matches one (ADR-0085)", async () => {
    listPersonEmailContactMethods.mockResolvedValue([
      { id: "cm-1", value: "casey@example.com", isPrimary: true },
    ]);
    await tool.execute(input(), ctx);
    expect(createGmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: {
          email: "casey@example.com",
          source: "contact_method",
          contactMethodId: "cm-1",
        },
      }),
    );
  });

  it("projects a safe model output — no send claim, no ids or provider payload", async () => {
    const result = await tool.execute(input(), ctx);
    const model = tool.toModelOutput?.(result as never);
    const serialized = JSON.stringify(model);
    // No provider id/payload leaks to the model.
    expect(serialized).not.toContain("g1");
    // No POSITIVE send claim (the no-send guardrail copy "never say it was sent" is
    // allowed and expected); it points the user to review/send from Gmail themselves.
    expect(serialized).not.toMatch(
      /(draft|email|message) (was|is|has been) sent|successfully sent|sent to \w+@/i,
    );
    expect(serialized).toMatch(/never say it was sent/i);
    expect(serialized).toMatch(/save|review/i);
  });
});

describe("save_draft_to_gmail policy is not forked from web", () => {
  it("composes the shared approval gate and shared service, not a local gate", () => {
    const source = readFileSync(join(process.cwd(), "agent/tools/save_draft_to_gmail.ts"), "utf8");
    // It builds the write path from the shared factories (ADR-0092), so chat cannot
    // fork approval/connection policy.
    expect(source).toContain("createDefaultGmailApprovalGate");
    expect(source).toContain("createDefaultGoogleGmailDraftService");
    // It never reimplements the gate with its own connection check.
    expect(source).not.toContain("isProviderCapabilityConnected");
    // It never sends: no send scope, host, or send verb on the tool surface.
    for (const forbidden of ["gmail.send", "messages/send", "googleapis.com", "sendMessage"]) {
      expect(source).not.toContain(forbidden);
    }
  });
});
