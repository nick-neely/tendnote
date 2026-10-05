import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { runBackgroundJobRecovery } = vi.hoisted(() => ({
  runBackgroundJobRecovery: vi.fn(),
}));
vi.mock("@/lib/background-jobs/recovery", () => ({ runBackgroundJobRecovery }));

vi.mock("@tendnote/db/queries/file-uploads", () => ({
  sweepFileStorage: vi.fn(async () => ({ deleted: 0, pending: 0 })),
}));

const { sweepUsageLedger } = vi.hoisted(() => ({
  sweepUsageLedger: vi.fn(async () => ({ deleted: 0 })),
}));
vi.mock("@tendnote/db/queries/usage-ledger", () => ({ sweepUsageLedger }));

const { sweepAccountFunnelEvents } = vi.hoisted(() => ({
  sweepAccountFunnelEvents: vi.fn(async () => ({ deleted: 0 })),
}));
vi.mock("@tendnote/db/queries/account-telemetry", () => ({ sweepAccountFunnelEvents }));

const { sweepPublicActivityCounts } = vi.hoisted(() => ({
  sweepPublicActivityCounts: vi.fn(async () => ({ deleted: 0 })),
}));
vi.mock("@tendnote/db/queries/public-activity", () => ({ sweepPublicActivityCounts }));

const { sweepEffectFences } = vi.hoisted(() => ({
  sweepEffectFences: vi.fn(async () => ({ deleted: 0, failed: false })),
}));
vi.mock("@tendnote/db/queries/effect-fences", () => ({ sweepEffectFences }));

const { sweepDeletionRecords } = vi.hoisted(() => ({
  sweepDeletionRecords: vi.fn(async () => ({ deleted: 0, failed: false })),
}));
vi.mock("@tendnote/db/queries/recovery-journal", () => ({ sweepDeletionRecords }));

const { sweepRestoredEmailFences } = vi.hoisted(() => ({
  sweepRestoredEmailFences: vi.fn(async () => ({ deleted: 0 })),
}));
vi.mock("@tendnote/db/queries/restored-email-fences", () => ({ sweepRestoredEmailFences }));

const { isOutboundPaused } = vi.hoisted(() => ({ isOutboundPaused: vi.fn(async () => false) }));
vi.mock("@tendnote/db/queries/outbound-pause", () => ({ isOutboundPaused }));
const { isServiceWideHoldActive } = vi.hoisted(() => ({
  isServiceWideHoldActive: vi.fn(async () => false),
}));
vi.mock("@tendnote/db/queries/service-wide-hold", () => ({ isServiceWideHoldActive }));

const { carryOutRetentionDeadlines } = vi.hoisted(() => ({
  carryOutRetentionDeadlines: vi.fn(async () => ({ scanned: 0 })),
}));
vi.mock("@/lib/access/account-retention", () => ({ carryOutRetentionDeadlines }));

const { reconcileStripe } = vi.hoisted(() => ({ reconcileStripe: vi.fn() }));
vi.mock("@/lib/billing/stripe-reconciliation", () => ({
  createStripeReconciliation: () => reconcileStripe,
}));
vi.mock("@/lib/billing/paid-access-projection", () => ({ paidAccessProjection: {} }));

const { runOperatorAlerts } = vi.hoisted(() => ({
  runOperatorAlerts: vi.fn(async (): Promise<Record<string, unknown>> => ({ status: "off" })),
}));
vi.mock("@/lib/operator-alerts/pass", () => ({ runOperatorAlerts }));

import { GET } from "./route";

const SECRET = "cron-secret-value";

function request(authorization?: string) {
  return new NextRequest("http://localhost/api/cron/background-jobs", {
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  runBackgroundJobRecovery.mockResolvedValue({ ok: true });
  reconcileStripe.mockResolvedValue({ status: "skipped" });
  // Default to the local-test environment with no opt-in.
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("CRON_SECRET", "");
  vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("background-jobs recovery cron route", () => {
  it("fails closed with 401 when CRON_SECRET is unset and no opt-in is present", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("rejects a wrong bearer token when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request("Bearer not-the-secret"));

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("rejects a missing Authorization header when CRON_SECRET is set", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("accepts the correct bearer token", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    expect(runBackgroundJobRecovery).toHaveBeenCalledTimes(1);
    expect(sweepUsageLedger).toHaveBeenCalledTimes(1);
    expect(sweepAccountFunnelEvents).toHaveBeenCalledTimes(1);
    expect(sweepPublicActivityCounts).toHaveBeenCalledTimes(1);
    expect(sweepEffectFences).toHaveBeenCalledTimes(1);
    expect(sweepRestoredEmailFences).toHaveBeenCalledTimes(1);
    expect(sweepDeletionRecords).toHaveBeenCalledTimes(1);
    expect(carryOutRetentionDeadlines).toHaveBeenCalledWith({ limit: 25 });
  });

  it("stands the whole pass down while a restore holds outbound", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    isOutboundPaused.mockResolvedValueOnce(true);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "paused" });
    expect(reconcileStripe).not.toHaveBeenCalled();
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
    expect(carryOutRetentionDeadlines).not.toHaveBeenCalled();
  });

  it("stands the whole pass down while a Service-Wide Hold is in force", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    isServiceWideHoldActive.mockResolvedValueOnce(true);

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "held" });
    expect(reconcileStripe).not.toHaveBeenCalled();
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
    expect(carryOutRetentionDeadlines).not.toHaveBeenCalled();
  });

  it("checks the pause only after authorizing", async () => {
    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(isOutboundPaused).not.toHaveBeenCalled();
  });

  it("allows the explicit development-only opt-in when no secret is configured", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "true");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(runBackgroundJobRecovery).toHaveBeenCalledTimes(1);
  });

  it("ignores the opt-in in production and preview (fails closed)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ALLOW_UNAUTHENTICATED_CRON", "true");

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(runBackgroundJobRecovery).not.toHaveBeenCalled();
  });

  it("reconciles Stripe on every authorized pass and reports it", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    reconcileStripe.mockResolvedValue({ status: "ran", scanned: 1, admitted: 1 });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(reconcileStripe).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      stripeReconciliation: { status: "ran", admitted: 1 },
    });
  });

  it("reconciles Stripe even when a later recovery stage fails", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    runBackgroundJobRecovery.mockRejectedValue(new Error("recovery stage failed"));

    await expect(GET(request(`Bearer ${SECRET}`))).rejects.toThrow(/recovery stage failed/);

    expect(reconcileStripe).toHaveBeenCalledOnce();
  });

  it("ends the pass with operator alerts over what the pass found", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const stripeReconciliation = { status: "ran", failed: 1, unmatchedRefunds: 0 };
    reconcileStripe.mockResolvedValue(stripeReconciliation);
    runOperatorAlerts.mockResolvedValue({ status: "ran", sent: 2, failed: 0 });

    const response = await GET(request(`Bearer ${SECRET}`));

    expect(runOperatorAlerts).toHaveBeenCalledWith({ stripeReconciliation });
    await expect(response.json()).resolves.toMatchObject({
      operatorAlerts: { status: "ran", sent: 2 },
    });
  });
});
