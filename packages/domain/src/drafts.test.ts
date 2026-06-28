import { describe, expect, it } from "vitest";
import {
  assertMessageDraftEditable,
  draftSourceRefSchema,
  draftSourceRefTrustForKind,
  resolveMessageDraftTransition,
} from "./drafts";

describe("draftSourceRefTrustForKind", () => {
  it("maps each kind to its canonical trust tier", () => {
    expect(draftSourceRefTrustForKind("approved_memory")).toBe("confirmed_fact");
    expect(draftSourceRefTrustForKind("source_record")).toBe("logged_context");
    expect(draftSourceRefTrustForKind("suggested_memory")).toBe("tentative");
    expect(draftSourceRefTrustForKind("followup")).toBe("intent");
    expect(draftSourceRefTrustForKind("brief_item")).toBe("entry_point");
  });
});

describe("draftSourceRefSchema", () => {
  it("rejects a trust tier that contradicts the kind", () => {
    expect(() =>
      draftSourceRefSchema.parse({
        kind: "suggested_memory",
        id: "m1",
        label: "Might like jazz",
        trust: "confirmed_fact",
      }),
    ).toThrow();
  });

  it("accepts a consistent reference", () => {
    expect(
      draftSourceRefSchema.parse({
        kind: "source_record",
        id: "sr1",
        label: "Talked about the move",
        trust: "logged_context",
      }),
    ).toMatchObject({ kind: "source_record", trust: "logged_context" });
  });
});

describe("resolveMessageDraftTransition", () => {
  it("allows approve only from draft", () => {
    expect(resolveMessageDraftTransition("draft", "approve")).toBe("approved");
    expect(() => resolveMessageDraftTransition("approved", "approve")).toThrow();
    expect(() => resolveMessageDraftTransition("dismissed", "approve")).toThrow();
  });

  it("allows dismiss and mark_sent_manually from draft or approved", () => {
    expect(resolveMessageDraftTransition("draft", "dismiss")).toBe("dismissed");
    expect(resolveMessageDraftTransition("approved", "dismiss")).toBe("dismissed");
    expect(resolveMessageDraftTransition("draft", "mark_sent_manually")).toBe("sent_manually");
    expect(resolveMessageDraftTransition("approved", "mark_sent_manually")).toBe("sent_manually");
  });

  it("rejects acting on an already-terminal draft", () => {
    expect(() => resolveMessageDraftTransition("sent_manually", "dismiss")).toThrow();
    expect(() => resolveMessageDraftTransition("dismissed", "mark_sent_manually")).toThrow();
  });
});

describe("assertMessageDraftEditable", () => {
  it("permits editing only active drafts", () => {
    expect(() => assertMessageDraftEditable("draft")).not.toThrow();
    expect(() => assertMessageDraftEditable("approved")).not.toThrow();
    expect(() => assertMessageDraftEditable("dismissed")).toThrow();
    expect(() => assertMessageDraftEditable("sent_manually")).toThrow();
  });
});
