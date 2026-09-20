import { randomUUID } from "node:crypto";
import { ceilingUsd as approvedCeilingUsd, models } from "./plan.mjs";
import { failureDetails } from "./transport.mjs";

const allowedModels = new Set(Object.values(models));
const number = (value, label) => {
  if (
    (typeof value !== "number" && typeof value !== "string") ||
    (typeof value === "string" && value.trim() === "") ||
    !Number.isFinite(Number(value)) ||
    Number(value) < 0
  )
    throw new Error(`Missing/invalid ${label}`);
  return Number(value);
};

export function reservationFor(model, body, catalog) {
  if (!allowedModels.has(model)) throw new Error("Unapproved model");
  const entry = catalog.find((item) => item.id === model);
  if (!entry) throw new Error("Model missing from current catalog");
  const rates = catalogRates(entry.pricing ?? {});
  if (!rates.length || rates.every((rate) => rate.input === 0))
    throw new Error("Missing positive model price");
  const inputRate = Math.max(...rates.map((rate) => rate.input));
  if (model === models.embedding) return embeddingReservation(body, inputRate);
  assertLanguageOptions(body);
  return languageReservation(entry, rates, inputRate);
}
function catalogRates(pricing) {
  const rates = [];
  if (pricing.input !== undefined)
    rates.push({
      input: number(pricing.input, "input price"),
      output: number(pricing.output ?? 0, "output price"),
    });
  for (const value of Object.values(pricing)) {
    if (value && typeof value === "object") rates.push(...catalogRates(value));
  }
  return rates;
}
function embeddingReservation(body, inputRate) {
  if (!Array.isArray(body.values) || !body.values.length || body.values.length > 16)
    throw new Error("Unbounded embedding batch");
  if (body.values.some((value) => typeof value !== "string" || Buffer.byteLength(value) > 8192))
    throw new Error("Unbounded embedding input");
  return 2 * 8192 * body.values.length * inputRate;
}
function assertLanguageOptions(body) {
  if (body.tools?.some((tool) => tool.type !== "function"))
    throw new Error("Provider tools are outside the replay budget");
  const gateway = body.providerOptions?.gateway ?? {};
  if (Object.keys(gateway).some((key) => !["user", "tags", "caching"].includes(key)))
    throw new Error("Unapproved gateway routing");
  if (gateway.caching !== undefined && gateway.caching !== "auto")
    throw new Error("Unapproved cache pricing");
}
function languageReservation(entry, rates, inputRate) {
  const input = number(entry.context_window, "context window");
  const output = number(entry.max_tokens, "output window");
  const outputRate = Math.max(...rates.map((rate) => rate.output));
  if (!input || !output || !outputRate) throw new Error("Missing model limits");
  // Twice the highest catalog rate for the ENTIRE context and output windows.
  return 2 * (input * inputRate + output * outputRate);
}

export function billingFromResponse(text, streaming, embedding) {
  const parts = streaming
    ? text
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .filter((line) => line && line !== "[DONE]")
        .map((line) => JSON.parse(line))
    : [JSON.parse(text)];
  if (parts.some((part) => part.type === "error")) throw new Error("Gateway stream failed");
  const finals = streaming ? parts.filter((part) => part.type === "finish") : parts;
  if (finals.length !== 1) throw new Error("Missing or duplicate terminal billing record");
  const final = finals[0];
  const usage = final.usage;
  const cost = number(final.providerMetadata?.gateway?.cost, "gateway cost");
  const input = number(
    embedding ? usage?.tokens : (usage?.inputTokens?.total ?? usage?.inputTokens),
    "input tokens",
  );
  const output = embedding
    ? 0
    : number(usage?.outputTokens?.total ?? usage?.outputTokens, "output tokens");
  const generationId = final.providerMetadata?.gateway?.generationId;
  return {
    costUsd: cost,
    inputTokens: input,
    outputTokens: output,
    ...(typeof generationId === "string" && /^[\w.-]{1,200}$/.test(generationId)
      ? { generationId }
      : {}),
  };
}

export function createMeter({ ceilingUsd, persist }) {
  if (!(ceilingUsd > 0 && ceilingUsd <= approvedCeilingUsd))
    throw new Error(`Ceiling must be within $${approvedCeilingUsd}`);
  const rows = [];
  let stopped = null;
  let pendingRequests = 0;
  let pending = Promise.resolve();
  const knownSpend = () => rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0);
  const reportingSpend = () =>
    rows.reduce(
      (sum, row) => sum + (row.costUsd === undefined ? 0 : (row.reportingWriteUsd ?? 0)),
      0,
    );
  const reservedSpend = () =>
    rows.reduce((sum, row) => sum + (row.costUsd === undefined ? row.reservationUsd : 0), 0);
  const snapshot = () => ({
    ceilingUsd,
    stopped,
    pendingRequests,
    rows,
    knownSpendUsd: knownSpend(),
    reportingWriteUsd: reportingSpend(),
    reservedUsd: reservedSpend(),
    accountedSpendUsd: knownSpend() + reportingSpend() + reservedSpend(),
  });
  return {
    snapshot,
    idle: async () => {
      await pending;
    },
    stop(reason) {
      stopped ??= reason;
      persist(snapshot());
    },
    async run(details, reservationUsd, call) {
      pendingRequests++;
      const previous = pending;
      let release;
      pending = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      try {
        if (stopped) throw new Error(stopped);
        const current = snapshot();
        if (
          !Number.isFinite(reservationUsd) ||
          reservationUsd <= 0 ||
          current.accountedSpendUsd + reservationUsd > ceilingUsd
        ) {
          stopped = "budget-reservation-refused";
          persist(snapshot());
          throw new Error(stopped);
        }
        const row = {
          ...details,
          requestId: randomUUID(),
          startedAt: new Date().toISOString(),
          reservationUsd,
          status: "reserved",
        };
        rows.push(row);
        persist(snapshot()); // Durable before crossing the paid boundary.
        try {
          const result = await call(row, () => persist(snapshot()));
          if (!Number.isFinite(result.billing.costUsd) || result.billing.costUsd < 0)
            throw new Error("Invalid cost");
          Object.assign(row, result.billing, {
            status: "settled",
            finishedAt: new Date().toISOString(),
          });
          if (row.costUsd + (row.reportingWriteUsd ?? 0) > reservationUsd)
            throw new Error("Catalog reservation exceeded");
          persist(snapshot());
          return result.response;
        } catch (error) {
          row.status = "uncertain";
          row.finishedAt = new Date().toISOString();
          row.failure = failureDetails(error);
          stopped = "request-failed-or-billing-incomplete";
          persist(snapshot());
          throw error;
        }
      } finally {
        pendingRequests--;
        release();
      }
    },
  };
}
