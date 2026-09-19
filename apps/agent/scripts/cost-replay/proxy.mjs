import { createServer } from "node:http";
import { billingFromResponse, createMeter, reservationFor } from "./meter.mjs";
import { models } from "./plan.mjs";

export async function startProxy(options) {
  const meter = createMeter(options);
  const context = {
    ...options,
    meter,
    abort: new AbortController(),
    phase: { variant: "preflight", category: "interactive" },
  };
  const server = createServer(async (req, res) => {
    try {
      if (req.headers["x-cost-proxy-token"] !== options.token) {
        res.writeHead(403).end();
        return;
      }
      const response = await routeRequest(req, context);
      // Fetch decodes compressed bodies but retains the upstream wire headers.
      const body = await response.text();
      const headers = new Headers(response.headers);
      headers.delete("content-encoding");
      headers.delete("content-length");
      headers.delete("transfer-encoding");
      res.writeHead(response.status, Object.fromEntries(headers)).end(body);
    } catch (error) {
      console.error("Cost proxy rejected request:", req.method, req.url, error.message);
      meter.stop("proxy-stopped; inspect content-free ledger");
      res
        .writeHead(402, { "content-type": "application/json" })
        .end(JSON.stringify({ error: "Cost replay stopped; no further inference is permitted." }));
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    meter,
    close: async () => {
      context.abort.abort();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
      await meter.idle();
    },
  };
}
async function routeRequest(req, context) {
  if (req.method === "GET") return readEndpoint(req.url, context);
  if (req.method !== "POST") throw new Error("Unapproved method");
  const body = await readBody(req);
  if (req.url === "/phase") return setPhase(body, context);
  return inference(req, body, context);
}
async function readEndpoint(path, context) {
  if (path === "/status") return Response.json(context.meter.snapshot());
  if (path === "/v1/models") return Response.json({ data: context.catalog });
  if (path === "/v1/models/catalog") return modelCatalog(context);
  throw new Error("Unapproved gateway endpoint");
}
async function modelCatalog(context) {
  if (!context.simulated)
    return fetch("https://ai-gateway.vercel.sh/v1/models/catalog", {
      signal: context.abort.signal,
    });
  return Response.json({
    models: context.catalog.map((item) => ({
      slug: item.id,
      providers: [
        {
          provider: item.id.split("/")[0],
          providerModelId: item.id.split("/")[1],
          contextWindowTokens: item.context_window,
          maxOutputTokens: item.max_tokens,
        },
      ],
    })),
    providerAliases: {},
  });
}
async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error("Oversized request");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}
function setPhase(phase, context) {
  if (
    !["light", "typical", "heavy", "smoke"].includes(phase.variant) ||
    !["interactive", "scheduled"].includes(phase.category)
  )
    throw new Error("Invalid phase");
  if (context.meter.snapshot().pendingRequests > 0)
    throw new Error("Phase changed during inference");
  context.phase = phase;
  return Response.json({});
}
function requestDetails(req, phase) {
  const embedding = req.url === "/v4/ai/embedding-model";
  if (!embedding && req.url !== "/v4/ai/language-model")
    throw new Error("Unapproved gateway endpoint");
  const model = req.headers[embedding ? "ai-model-id" : "ai-language-model-id"];
  const streaming = req.headers["ai-language-model-streaming"] === "true";
  return {
    embedding,
    model,
    streaming,
    category: categoryFor({ embedding, model, streaming, phase }),
  };
}
function categoryFor({ embedding, model, streaming, phase }) {
  if (embedding) return "embedding";
  if (model === models.extraction) return "extraction";
  if (phase.category === "scheduled") return "scheduled";
  return streaming ? "interactive" : "snapshot";
}
async function inference(req, body, context) {
  const details = requestDetails(req, context.phase);
  const reservationUsd = reservationFor(details.model, body, context.catalog);
  const { model, category } = details;
  const row = { variant: context.phase.variant, model, category };
  return context.meter.run(row, reservationUsd, async () => {
    const response = context.simulated
      ? fakeResponse(details.streaming, details.embedding, body)
      : await upstream(req, body, row, context);
    if (!response.ok) throw new Error(`Gateway returned ${response.status}`);
    // Buffer one response so concurrent child calls cannot get ahead of settlement.
    const text = await response.text();
    const billing = billingFromResponse(text, details.streaming, details.embedding);
    return {
      billing,
      response: new Response(text, {
        headers: { "content-type": response.headers.get("content-type") ?? "application/json" },
      }),
    };
  });
}
async function upstream(req, body, row, context) {
  const headers = gatewayHeaders(req, context.apiKey);
  body.providerOptions ??= {};
  body.providerOptions.gateway = {
    ...(body.providerOptions.gateway?.caching === "auto" ? { caching: "auto" } : {}),
    user: "tendnote-synthetic-cost-replay",
    tags: [`cost:${row.variant}`, `category:${row.category}`],
  };
  return fetch(`https://ai-gateway.vercel.sh${req.url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.any([context.abort.signal, AbortSignal.timeout(180000)]),
  });
}
function gatewayHeaders(req, apiKey) {
  const headers = new Headers({
    "content-type": "application/json",
    authorization: `Bearer ${apiKey}`,
    "ai-gateway-auth-method": "api-key",
  });
  for (const name of [
    "ai-gateway-protocol-version",
    "ai-language-model-specification-version",
    "ai-language-model-id",
    "ai-language-model-streaming",
    "ai-embedding-model-specification-version",
    "ai-model-id",
  ]) {
    if (req.headers[name]) headers.set(name, req.headers[name]);
  }
  return headers;
}
function fakeResponse(streaming, embedding, body) {
  const providerMetadata = { gateway: { cost: "0.001" } };
  if (embedding)
    return Response.json({
      embeddings: [Array(1536).fill(0.01)],
      usage: { tokens: 10 },
      providerMetadata,
    });
  const reply =
    body.responseFormat?.type === "json"
      ? JSON.stringify({ candidates: [] })
      : "Synthetic smoke reply.";
  const usage = {
    inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: 5, text: 5, reasoning: 0 },
  };
  if (!streaming)
    return Response.json({
      content: [{ type: "text", text: reply }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      providerMetadata,
      warnings: [],
    });
  return new Response(
    [
      { type: "stream-start", warnings: [] },
      { type: "text-start", id: "smoke" },
      { type: "text-delta", id: "smoke", delta: reply },
      { type: "text-end", id: "smoke" },
      { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage, providerMetadata },
    ]
      .map((part) => `data: ${JSON.stringify(part)}\n\n`)
      .join(""),
    { headers: { "content-type": "text/event-stream" } },
  );
}
