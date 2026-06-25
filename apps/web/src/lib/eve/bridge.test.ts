import { describe, expect, it, vi } from "vitest";
import {
  type EveChatTransport,
  type EveTurnTransportInput,
  type EveTurnTransportResult,
  runWebChatTurn,
} from "./bridge";

function transportReturning(result: Partial<EveTurnTransportResult>): {
  transport: EveChatTransport;
  calls: EveTurnTransportInput[];
} {
  const calls: EveTurnTransportInput[] = [];
  const transport: EveChatTransport = {
    sendTurn: vi.fn(async (input: EveTurnTransportInput) => {
      calls.push(input);
      return {
        status: "completed",
        message: undefined,
        sessionId: "session-1",
        toolResults: [],
        ...result,
      } satisfies EveTurnTransportResult;
    }),
  };

  return { transport, calls };
}

describe("runWebChatTurn (web → Eve bridge seam)", () => {
  it("forwards the owner-scoped message to Eve and returns the assistant reply", async () => {
    const { transport, calls } = transportReturning({
      message: "Saved a note about Mark.",
    });

    const result = await runWebChatTurn(
      { ownerUserId: "user-1", message: "Had lunch with Mark." },
      transport,
    );

    expect(calls).toHaveLength(1);
    expect(calls[0]?.ownerUserId).toBe("user-1");
    expect(calls[0]?.message).toBe("Had lunch with Mark.");
    expect(result.assistantText).toBe("Saved a note about Mark.");
    expect(result.status).toBe("completed");
    expect(result.sessionId).toBe("session-1");
  });

  it("passes a resolved person profile to Eve as turn client context", async () => {
    const { transport, calls } = transportReturning({ message: "Noted." });

    await runWebChatTurn(
      {
        ownerUserId: "user-1",
        message: "He might be switching jobs.",
        personContext: { personId: "person-7", personName: "Mark" },
      },
      transport,
    );

    expect(calls[0]?.clientContext).toEqual({
      person: { id: "person-7", displayName: "Mark" },
    });
  });

  it("omits client context when no person is resolved", async () => {
    const { transport, calls } = transportReturning({ message: "Noted." });

    await runWebChatTurn({ ownerUserId: "user-1", message: "Hello." }, transport);

    expect(calls[0]?.clientContext).toBeUndefined();
  });

  it("surfaces persisted tool results so the UI can render saved records", async () => {
    const { transport } = transportReturning({
      message: "Saved that note.",
      toolResults: [
        {
          toolName: "capture_source_record",
          output: { sourceRecord: { id: "source-1" }, component: { type: "source_record" } },
        },
      ],
    });

    const result = await runWebChatTurn(
      { ownerUserId: "user-1", message: "Had lunch with Mark." },
      transport,
    );

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]?.toolName).toBe("capture_source_record");
  });

  it("falls back to an error reply when the turn fails without assistant text", async () => {
    const { transport } = transportReturning({ status: "failed", message: undefined });

    const result = await runWebChatTurn(
      { ownerUserId: "user-1", message: "Had lunch with Mark." },
      transport,
    );

    expect(result.status).toBe("failed");
    expect(result.assistantText).toMatch(/couldn't|try again/i);
  });
});
