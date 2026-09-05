import { describe, expect, it } from "vitest";
import {
  EVE_APPROVAL_DECISION_ID_MAX_LENGTH,
  eveApprovalDecisionInputSchema,
  eveApprovalDecisionSettledOutcomeSchema,
} from "./eve-approval-decisions";

const VALID = {
  sessionId: "wrun_1",
  turnId: "turn_1",
  callId: "call_1",
  toolName: "capture_memory",
  tier: "reversible_private",
  modeAtDecision: "trusted",
  tainted: false,
  outcome: "auto_approved",
} as const;

describe("eve approval decision input", () => {
  it("accepts the three outcomes the policy can reach", () => {
    for (const outcome of ["parked", "auto_approved", "denied"] as const) {
      expect(eveApprovalDecisionInputSchema.parse({ ...VALID, outcome }).outcome).toBe(outcome);
    }
  });

  it("accepts both tiers and both Approval Modes", () => {
    for (const tier of ["reversible_private", "always_ask"] as const) {
      expect(eveApprovalDecisionInputSchema.parse({ ...VALID, tier }).tier).toBe(tier);
    }
    for (const modeAtDecision of ["ask", "trusted"] as const) {
      expect(
        eveApprovalDecisionInputSchema.parse({ ...VALID, modeAtDecision }).modeAtDecision,
      ).toBe(modeAtDecision);
    }
  });

  it("refuses vocabulary the record has no meaning for", () => {
    // The audit row answers "what did the policy do"; a value nothing produces
    // would make it answer something else later without anybody noticing.
    expect(() =>
      eveApprovalDecisionInputSchema.parse({ ...VALID, outcome: "auto-approved" }),
    ).toThrow();
    expect(() => eveApprovalDecisionInputSchema.parse({ ...VALID, tier: "safe" })).toThrow();
    expect(() =>
      eveApprovalDecisionInputSchema.parse({ ...VALID, modeAtDecision: "yolo" }),
    ).toThrow();
  });

  it("bounds every identifier it stores", () => {
    const tooLong = "a".repeat(EVE_APPROVAL_DECISION_ID_MAX_LENGTH + 1);

    expect(() => eveApprovalDecisionInputSchema.parse({ ...VALID, sessionId: tooLong })).toThrow();
    expect(() => eveApprovalDecisionInputSchema.parse({ ...VALID, turnId: tooLong })).toThrow();
    expect(() => eveApprovalDecisionInputSchema.parse({ ...VALID, callId: tooLong })).toThrow();
    expect(() =>
      eveApprovalDecisionInputSchema.parse({ ...VALID, toolName: "a".repeat(121) }),
    ).toThrow();
    expect(() => eveApprovalDecisionInputSchema.parse({ ...VALID, callId: "  " })).toThrow();
  });

  it("settles only to an outcome an owner can actually produce", () => {
    expect(eveApprovalDecisionSettledOutcomeSchema.parse("allowed")).toBe("allowed");
    expect(eveApprovalDecisionSettledOutcomeSchema.parse("cancelled")).toBe("cancelled");
    expect(() => eveApprovalDecisionSettledOutcomeSchema.parse("denied")).toThrow();
  });
});
