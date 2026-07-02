"use client";

export async function ensureLocalDemoAuthSessionIfNeeded(
  enabled: boolean,
  fetchImpl: typeof fetch = fetch,
) {
  if (!enabled) {
    return;
  }

  const response = await fetchImpl("/api/dev/demo-session", { method: "POST" });
  if (!response.ok) {
    throw new Error("Local demo auth session could not be created.");
  }
}
