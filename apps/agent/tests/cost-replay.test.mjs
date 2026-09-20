import { describe, expect, it, vi } from "vitest";
import { billingFromResponse, createMeter, reservationFor } from "../scripts/cost-replay/meter.mjs";
import {
  assertEvalDatabase,
  ceilingUsd,
  cleanEnvironment,
  models,
  variants,
} from "../scripts/cost-replay/plan.mjs";
import { startProxy } from "../scripts/cost-replay/proxy.mjs";

const catalog = Object.values(models).map((id) => ({
  id,
  context_window: 1000000,
  max_tokens: 65536,
  pricing: { input: "0.000001", output: "0.000004" },
}));
const billing = (costUsd) => ({ costUsd, inputTokens: 100, outputTokens: 20 });

describe("cost replay paid boundary", () => {
  it("pins the newly approved combined ceiling and refuses any larger allowance", () => {
    expect(ceilingUsd).toBe(50);
    expect(createMeter({ ceilingUsd, persist() {} }).snapshot().ceilingUsd).toBe(50);
    expect(() => createMeter({ ceilingUsd: 50.01, persist() {} })).toThrow("within $50");
  });
  it("keeps production credentials and non-eval databases out of the child", () => {
    expect(() => assertEvalDatabase("postgres://x@db.example.com/tendnote_eval")).toThrow();
    expect(() => assertEvalDatabase("postgres://x@localhost/tendnote")).toThrow();
    expect(() => assertEvalDatabase("postgres://x@localhost/tendnote_eval?host=prod")).toThrow();
    expect(assertEvalDatabase("postgres://x@127.0.0.1/tendnote_eval")).toContain("tendnote_eval");
    const env = cleanEnvironment({
      AI_GATEWAY_API_KEY: "secret",
      DATABASE_URL: "production",
      VERCEL_OIDC_TOKEN: "secret",
      DISCORD_BOT_TOKEN: "secret",
      NODE_OPTIONS: "--import=bad",
      PATH: "/bin",
    });
    expect(JSON.stringify(env)).not.toMatch(/secret|production|--import=bad/);
  });
  it("refuses the next call before it can exceed the remaining allowance", async () => {
    const persist = vi.fn();
    const meter = createMeter({ ceilingUsd: 1, persist });
    const call = vi.fn(async () => ({ billing: billing(0.7), response: "ok" }));
    await meter.run({}, 0.8, call);
    await expect(meter.run({}, 0.4, call)).rejects.toThrow("budget");
    expect(call).toHaveBeenCalledTimes(1);
    expect(meter.snapshot().knownSpendUsd).toBe(0.7);
  });
  it("serializes concurrent callers and persists reservations before sending", async () => {
    const states = [];
    const meter = createMeter({
      ceilingUsd: 1,
      persist: (state) => states.push(structuredClone(state)),
    });
    let release;
    const waiting = new Promise((resolve) => {
      release = resolve;
    });
    const first = meter.run({}, 0.8, async () => {
      expect(states[0].reservedUsd).toBe(0.8);
      await waiting;
      return { billing: billing(0.6), response: "first" };
    });
    const next = vi.fn();
    const second = meter.run({}, 0.5, next);
    release();
    await first;
    await expect(second).rejects.toThrow("budget");
    expect(next).not.toHaveBeenCalled();
  });
  it("retains uncertain spend and blocks retries after missing billing or transport failure", async () => {
    const meter = createMeter({ ceilingUsd: 25, persist() {} });
    await expect(
      meter.run({}, 2, async () => {
        throw new Error("EOF");
      }),
    ).rejects.toThrow();
    const retry = vi.fn();
    await expect(meter.run({}, 2, retry)).rejects.toThrow();
    expect(retry).not.toHaveBeenCalled();
    expect(meter.snapshot().reservedUsd).toBe(2);
  });
  it("reserves the whole model context at the highest catalog price", () => {
    expect(reservationFor(models.agent, {}, catalog)).toBeCloseTo(2.524288);
    expect(() => reservationFor("unapproved/model", {}, catalog)).toThrow();
    expect(() =>
      reservationFor(models.agent, { tools: [{ type: "provider-defined" }] }, catalog),
    ).toThrow();
    expect(() =>
      reservationFor(
        models.agent,
        { providerOptions: { gateway: { models: ["other"] } } },
        catalog,
      ),
    ).toThrow();
    expect(() =>
      reservationFor(models.embedding, { values: ["x".repeat(32769)] }, catalog),
    ).toThrow();
  });
  it("requires explicit cost and usage instead of interpreting missing values as zero", () => {
    expect(() => billingFromResponse("{}", false, false)).toThrow();
    expect(() =>
      billingFromResponse('data: {"type":"text-delta","delta":"hi"}\n\n', true, false),
    ).toThrow();
    const final = {
      type: "finish",
      usage: { inputTokens: { total: 20 }, outputTokens: { total: 4 } },
      providerMetadata: { gateway: { cost: "0.01" } },
    };
    expect(billingFromResponse(`data: ${JSON.stringify(final)}\n\n`, true, false)).toEqual({
      costUsd: 0.01,
      inputTokens: 20,
      outputTokens: 4,
    });
    expect(() =>
      billingFromResponse(
        `data: ${JSON.stringify(final)}\ndata: ${JSON.stringify(final)}\n`,
        true,
        false,
      ),
    ).toThrow();
  });
  it("meters language streaming and embeddings through the real local HTTP boundary without upstream calls", async () => {
    const upstream = vi.spyOn(globalThis, "fetch");
    const proxy = await startProxy({
      token: "test",
      catalog,
      ceilingUsd: 25,
      persist() {},
      simulated: true,
    });
    try {
      await fetch(`${proxy.url}/phase`, {
        method: "POST",
        headers: { "x-cost-proxy-token": "test" },
        body: JSON.stringify({ variant: "light", category: "interactive" }),
      });
      const response = await fetch(`${proxy.url}/v4/ai/language-model`, {
        method: "POST",
        headers: {
          "x-cost-proxy-token": "test",
          "ai-language-model-id": models.agent,
          "ai-language-model-streaming": "true",
        },
        body: "{}",
      });
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("Synthetic smoke reply");
      await fetch(`${proxy.url}/v4/ai/embedding-model`, {
        method: "POST",
        headers: {
          "x-cost-proxy-token": "test",
          "ai-model-id": models.embedding,
        },
        body: JSON.stringify({ values: ["synthetic"] }),
      });
      expect(proxy.meter.snapshot().rows.map((row) => row.category)).toEqual([
        "interactive",
        "embedding",
      ]);
      expect(upstream.mock.calls.every(([url]) => String(url).startsWith(proxy.url))).toBe(true);
    } finally {
      await proxy.close();
      upstream.mockRestore();
    }
  });
  it("pins the approved workload sizes", () => {
    expect(Object.values(variants).map((row) => row.turns)).toEqual([40, 150, 600]);
    expect(Object.values(variants).map((row) => row.captures)).toEqual([20, 80, 300]);
  });
});

// Budget correctness includes preserving Eve's default automatic prompt caching.
it("permits auto caching without allowing routing or price changes", () => {
  expect(
    reservationFor(models.agent, { providerOptions: { gateway: { caching: "auto" } } }, catalog),
  ).toBeGreaterThan(0);
  expect(() =>
    reservationFor(
      models.agent,
      { providerOptions: { gateway: { caching: "extended" } } },
      catalog,
    ),
  ).toThrow();
});

it("forwards paid-path requests only after reservation and substitutes parent-held credentials", async () => {
  const original = globalThis.fetch;
  let forwarded;
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url).startsWith("https://ai-gateway.vercel.sh/")) {
      forwarded = init;
      return Response.json({
        content: [{ type: "text", text: "fixture" }],
        usage: { inputTokens: 50, outputTokens: 10 },
        providerMetadata: { gateway: { cost: "0.01" } },
      });
    }
    return original(url, init);
  });
  const snapshots = [];
  const proxy = await startProxy({
    apiKey: "parent-test-secret",
    token: "test",
    catalog,
    ceilingUsd: 25,
    persist: (state) => snapshots.push(structuredClone(state)),
  });
  try {
    const response = await fetch(`${proxy.url}/v4/ai/language-model`, {
      method: "POST",
      headers: {
        "x-cost-proxy-token": "test",
        authorization: "Bearer child-dummy",
        "ai-language-model-id": models.agent,
      },
      body: JSON.stringify({ providerOptions: { gateway: { caching: "auto" } } }),
    });
    expect(response.status).toBe(200);
    expect(snapshots[0].rows[0].status).toBe("reserved");
    expect(forwarded.headers.get("authorization")).toBe("Bearer parent-test-secret");
    expect(forwarded.headers.has("x-cost-proxy-token")).toBe(false);
    expect(JSON.parse(forwarded.body).providerOptions.gateway.caching).toBe("auto");
    expect(proxy.meter.snapshot().knownSpendUsd).toBe(0.01);
    expect(proxy.meter.snapshot().pendingRequests).toBe(0);
  } finally {
    await proxy.close();
    fetchSpy.mockRestore();
  }
});

it("forwards decoded catalog metadata without upstream compression or length headers", async () => {
  const original = globalThis.fetch;
  const metadata = { models: [{ slug: models.agent }] };
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    if (String(url) === "https://ai-gateway.vercel.sh/v1/models/catalog") {
      return new Response(JSON.stringify(metadata), {
        headers: {
          "content-type": "application/json",
          "content-encoding": "br",
          "content-length": "9999",
        },
      });
    }
    return original(url, init);
  });
  const proxy = await startProxy({ token: "test", catalog, ceilingUsd: 25, persist() {} });
  try {
    const response = await fetch(`${proxy.url}/v1/models/catalog`, {
      headers: { "x-cost-proxy-token": "test" },
    });
    expect(response.headers.has("content-encoding")).toBe(false);
    expect(await response.json()).toEqual(metadata);
    expect(proxy.meter.snapshot().rows).toEqual([]);
  } finally {
    await proxy.close();
    fetchSpy.mockRestore();
  }
});

it("isolates the approved canary from the full baseline scope and acknowledgement", async () => {
  const { replayScope, variants } = await import("../scripts/cost-replay/plan.mjs");
  expect(replayScope("--canary")).toEqual({
    days: 2,
    ceilingUsd: 10,
    reportQueryAllowanceUsd: 0.005,
    variants: ["heavy"],
    approval: "heavy-canary-10-usd",
  });
  expect(variants.heavy).toEqual({
    turns: 600,
    captures: 300,
    people: 150,
    followups: 100,
    uploads: 30,
  });
  expect(replayScope("--paid")).toMatchObject({
    days: 30,
    ceilingUsd: 50,
    approval: "baseline-50-usd",
  });
});
