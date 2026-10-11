import type { ClaimedOperatorAlertNotice } from "@tendnote/db/queries/operator-alerts";
import { describe, expect, it } from "vitest";
import type { FirstValueCheck } from "../first-value-check";
import { noticeMessage } from "./notice-message";

const at = new Date("2026-10-11T17:50:00Z");
const notice: ClaimedOperatorAlertNotice = {
  condition: "first_value_path",
  kind: "alert",
  episodeId: "one",
  openedAt: at,
  clearedAt: null,
};
const failed: FirstValueCheck = {
  status: "ran",
  failed: ["model"],
  groundedAnswer: null,
  model: {
    passed: false,
    reason: "deadline",
    elapsedMs: 32_000,
    attempts: [
      { outcome: "deadline", phase: "gateway", elapsedMs: 15_000 },
      { outcome: "deadline", phase: "gateway", elapsedMs: 15_000 },
    ],
  },
};

describe("First Value alert messages", () => {
  it("names the failed step, attempts, phase and sample, with no customer-impact claim", () => {
    const message = noticeMessage(notice, { firstValue: failed, observedInThisPass: true });
    expect(message).toMatchObject({ urgent: true, key: "operator-alert:one:alert" });
    expect(message.body).toContain("Failed steps: model.");
    expect(message.body).toContain("32000 ms; 2 attempt(s)");
    expect(message.body).toContain("Attempt 1: deadline; 15000 ms; gateway generation.");
    expect(message.body).toContain("Attempt 2: deadline; 15000 ms; gateway generation.");
    expect(message.body).toContain(at.toISOString());
    expect(message.body).toContain("Customer impact is unverified");
  });

  it("does not substitute a later sample for an original episode's details", () => {
    for (const firstValue of [failed, null, { status: "off" as const }]) {
      const { body } = noticeMessage(notice, {
        firstValue,
        observedInThisPass: false,
      });
      expect(body).toContain("Original step details are unavailable");
      expect(body).not.toContain("Attempt 1");
      expect(body).toContain(at.toISOString());
    }
  });

  it("reports the recorded recovery sample even when delivery is retried during a new failure", () => {
    const clearedAt = new Date("2026-10-11T18:00:00Z");
    const message = noticeMessage(
      { ...notice, kind: "recovery", clearedAt },
      {
        firstValue: failed,
        observedInThisPass: false,
      },
    );
    expect(message).toMatchObject({ urgent: false, key: "operator-alert:one:recovery" });
    expect(message.body).toContain(`Passing sample: ${clearedAt.toISOString()}`);
    expect(message.body).toContain("do not measure continuous outage duration");
    expect(message.body).not.toContain("Failed steps");
  });

  it("allowlists exported details instead of copying error strings or payloads", () => {
    const firstValue: FirstValueCheck = {
      status: "ran",
      failed: ["landing", "model"],
      groundedAnswer: null,
      model: {
        passed: false,
        reason: "secret-value",
        elapsedMs: 17_000,
        attempts: [
          {
            outcome: "failed",
            phase: "usage_ledger",
            elapsedMs: 100,
            retryable: false,
            status: 503,
            error: "secret-value",
            type: "secret-value",
            generationId: "secret-value",
          },
        ],
      },
    };
    const { body } = noticeMessage(notice, { firstValue, observedInThisPass: true });
    expect(body).toContain("Failed steps: landing page, model");
    expect(body).toContain("usage-ledger persistence; HTTP 503");
    expect(body).not.toContain("secret-value");
  });

  it("keeps unrelated conditions' messages and idempotency keys", () => {
    expect(
      noticeMessage(
        { ...notice, condition: "spend_breaker" },
        { firstValue: failed, observedInThisPass: true },
      ),
    ).toMatchObject({ title: "Spend Breaker tripped", key: "operator-alert:one:alert" });
  });
});
