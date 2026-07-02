import { describe, expect, it, vi } from "vitest";
import { ensureLocalDemoAuthSessionIfNeeded } from "./local-demo-session-client";

describe("ensureLocalDemoAuthSessionIfNeeded", () => {
  it("does nothing for normal signed-in sessions", async () => {
    const fetchImpl = vi.fn();

    await ensureLocalDemoAuthSessionIfNeeded(false, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("creates a local demo Better Auth session before linkSocial", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });

    await ensureLocalDemoAuthSessionIfNeeded(true, fetchImpl as unknown as typeof fetch);

    expect(fetchImpl).toHaveBeenCalledWith("/api/dev/demo-session", { method: "POST" });
  });

  it("fails before linkSocial when the local session bridge is unavailable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: false });

    await expect(
      ensureLocalDemoAuthSessionIfNeeded(true, fetchImpl as unknown as typeof fetch),
    ).rejects.toThrow("Local demo auth session could not be created.");
  });
});
