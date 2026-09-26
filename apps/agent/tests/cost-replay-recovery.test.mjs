import { describe, expect, it, vi } from "vitest";
import { models } from "../scripts/cost-replay/plan.mjs";
import { startProxy } from "../scripts/cost-replay/proxy.mjs";

vi.mock("node:timers/promises", () => ({ setTimeout: async () => {} }));

const catalog = Object.values(models).map((id) => ({
  id,
  context_window: 1000000,
  max_tokens: 65536,
  pricing: { input: "0.000001", output: "0.000004" },
}));
const response = () =>
  Response.json(
    {
      content: [],
      usage: { inputTokens: 50, outputTokens: 10 },
      providerMetadata: { gateway: { cost: "0.01", generationId: "gen-fixture" } },
    },
    { headers: { "x-vercel-id": "iad1::fixture" } },
  );

async function exercise(upstream, ceilingUsd = 25) {
  const original = globalThis.fetch;
  const spy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((url, init) =>
      String(url).startsWith("https://ai-gateway.vercel.sh/")
        ? upstream(url, init)
        : original(url, init),
    );
  const states = [];
  const proxy = await startProxy({
    token: "test",
    runId: "run-fixture",
    apiKey: "parent-secret",
    catalog,
    ceilingUsd,
    persist: (state) => states.push(structuredClone(state)),
  });
  const request = () =>
    fetch(`${proxy.url}/v4/ai/language-model`, {
      method: "POST",
      headers: { "x-cost-proxy-token": "test", "ai-language-model-id": models.agent },
      body: "{}",
    });
  return {
    proxy,
    request,
    states,
    close: async () => {
      await proxy.close();
      spy.mockRestore();
    },
  };
}

describe("cost replay transport recovery and reconciliation", () => {
  it("retries a connection establishment failure without duplicating a billed request", async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError("fetch failed", {
          cause: Object.assign(new Error("connect failed"), {
            code: "ECONNREFUSED",
            syscall: "connect",
          }),
        }),
      )
      .mockImplementation(response);
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(2);
      const state = test.proxy.meter.snapshot();
      expect(state.rows).toHaveLength(1);
      expect(state.rows[0]).toMatchObject({
        status: "settled",
        generationId: "gen-fixture",
        attempts: 2,
      });
      expect(state.knownSpendUsd).toBe(0.01);
    } finally {
      await test.close();
    }
  });
  it("survives a DNS outage lasting three attempts without billing duplicate requests", async () => {
    let attempts = 0;
    const upstream = vi.fn().mockImplementation(() => {
      if (++attempts <= 3)
        throw new TypeError("fetch failed", {
          cause: { code: "EAI_AGAIN", syscall: "getaddrinfo" },
        });
      return response();
    });
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(200);
      expect(upstream).toHaveBeenCalledTimes(4);
      expect(test.proxy.meter.snapshot().knownSpendUsd).toBe(0.01);
    } finally {
      await test.close();
    }
  });
  it("keeps billing uncertain when a DNS retry is followed by an ambiguous disconnect", async () => {
    const upstream = vi
      .fn()
      .mockRejectedValueOnce(
        new TypeError("fetch failed", { cause: { code: "EAI_AGAIN", syscall: "getaddrinfo" } }),
      )
      .mockRejectedValue(
        new TypeError("fetch failed", { cause: { code: "ECONNRESET", syscall: "read" } }),
      );
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(402);
      expect(upstream).toHaveBeenCalledTimes(2);
      expect(test.proxy.meter.snapshot().rows[0]).toMatchObject({
        status: "uncertain",
        attempts: 2,
      });
      expect(test.proxy.meter.snapshot().reservedUsd).toBeGreaterThan(0);
    } finally {
      await test.close();
    }
  });
  it("persists content-free network diagnostics and never retries an ambiguous disconnect", async () => {
    const upstream = vi.fn().mockRejectedValue(
      new TypeError("secret-prompt", {
        cause: Object.assign(new Error("Bearer parent-secret"), {
          code: "ECONNRESET",
          syscall: "read",
        }),
      }),
    );
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(402);
      expect((await test.request()).status).toBe(402);
      expect(upstream).toHaveBeenCalledTimes(1);
      const state = test.proxy.meter.snapshot();
      expect(state.rows[0]).toMatchObject({
        status: "uncertain",
        attempts: 1,
        failure: { name: "TypeError", code: "ECONNRESET", syscall: "read" },
      });
      expect(state.rows[0].requestId).toEqual(expect.any(String));
      expect(state.rows[0].startedAt).toEqual(expect.any(String));
      expect(state.rows[0].finishedAt).toEqual(expect.any(String));
      expect(JSON.stringify(state)).not.toMatch(/secret-prompt|parent-secret/);
      expect(state.reservedUsd).toBeGreaterThan(2);
    } finally {
      await test.close();
    }
  });
  it("budgets reporting writes as well as inference before sending", async () => {
    const upstream = vi.fn().mockImplementation(response);
    const test = await exercise(upstream, 2.5244);
    try {
      expect((await test.request()).status).toBe(402);
      expect(upstream).not.toHaveBeenCalled();
    } finally {
      await test.close();
    }
  });
  it("counts reporting fees from settled calls against the next reservation", async () => {
    const upstream = vi.fn().mockImplementation(response);
    const test = await exercise(upstream, 2.5346);
    try {
      expect((await test.request()).status).toBe(200);
      expect((await test.request()).status).toBe(402);
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally {
      await test.close();
    }
  });
  it("records provider IDs and reporting overhead without changing inference cost", async () => {
    const upstream = vi.fn().mockImplementation(response);
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(200);
      const state = test.proxy.meter.snapshot();
      expect(state.rows[0]).toMatchObject({
        generationId: "gen-fixture",
        gatewayRequestId: "iad1::fixture",
        reportingWriteUsd: 0.000225,
      });
      expect(state.accountedSpendUsd).toBeCloseTo(0.010225, 9);
      expect(state.reportingWriteUsd).toBeCloseTo(0.000225, 9);
      expect(state.knownSpendUsd).toBe(0.01);
      expect(JSON.parse(upstream.mock.calls[0][1].body).providerOptions.gateway.user).toBe(
        "cost-replay:run-fixture",
      );
    } finally {
      await test.close();
    }
  });
  it.each([{ code: "EAI_AGAIN", syscall: "getaddrinfo" }, { code: "UND_ERR_CONNECT_TIMEOUT" }])(
    "bounds connection retries for $code",
    async (cause) => {
      const upstream = vi.fn().mockRejectedValue(new TypeError("fetch failed", { cause }));
      const test = await exercise(upstream);
      try {
        expect((await test.request()).status).toBe(402);
        expect(upstream).toHaveBeenCalledTimes(8);
        expect(test.proxy.meter.snapshot().rows[0]).toMatchObject({
          attempts: 8,
          status: "settled",
          costUsd: 0,
          reportingWriteUsd: 0,
          failureStage: "before-connect",
        });
        expect(test.proxy.meter.snapshot().reservedUsd).toBe(0);
        expect((await test.request()).status).toBe(402);
        expect(upstream).toHaveBeenCalledTimes(8);
      } finally {
        await test.close();
      }
    },
  );
  it.each([new DOMException("timeout", "TimeoutError"), new Error("unknown")])(
    "never retries a failure without proof of pre-dispatch failure",
    async (error) => {
      const upstream = vi.fn().mockRejectedValue(error);
      const test = await exercise(upstream);
      try {
        expect((await test.request()).status).toBe(402);
        expect(upstream).toHaveBeenCalledTimes(1);
      } finally {
        await test.close();
      }
    },
  );
  it("retains response identity on HTTP errors without a retry", async () => {
    const upstream = vi.fn().mockImplementation(
      () =>
        new Response("private provider error", {
          status: 503,
          headers: { "x-vercel-id": "iad1::failed" },
        }),
    );
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(402);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(test.proxy.meter.snapshot().rows[0]).toMatchObject({
        status: "uncertain",
        httpStatus: 503,
        gatewayRequestId: "iad1::failed",
      });
      expect(JSON.stringify(test.states)).not.toContain("private provider error");
    } finally {
      await test.close();
    }
  });
  it("retains response identity if reading a successful response fails", async () => {
    const upstream = vi.fn().mockImplementation(
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("lost body"));
            },
          }),
          { headers: { "x-vercel-id": "iad1::lost-body" } },
        ),
    );
    const test = await exercise(upstream);
    try {
      expect((await test.request()).status).toBe(402);
      expect(upstream).toHaveBeenCalledTimes(1);
      expect(test.proxy.meter.snapshot().rows[0]).toMatchObject({
        status: "uncertain",
        httpStatus: 200,
        gatewayRequestId: "iad1::lost-body",
      });
    } finally {
      await test.close();
    }
  });
});
