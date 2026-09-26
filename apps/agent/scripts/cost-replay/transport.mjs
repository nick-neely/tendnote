import { setTimeout } from "node:timers/promises";

// Only codes proving failure before a connection was established are retryable.
// A reset, socket error, HTTP response, or generic timeout may already be billed.
function failedBeforeConnect(error) {
  const cause = error?.cause;
  return (
    (cause?.code === "ECONNREFUSED" && cause.syscall === "connect") ||
    (cause?.code === "EAI_AGAIN" && cause.syscall === "getaddrinfo") ||
    cause?.code === "UND_ERR_CONNECT_TIMEOUT"
  );
}

export function failureDetails(error) {
  const cause = error?.cause;
  const knownNames = ["Error", "TypeError", "AbortError", "TimeoutError", "SyntaxError"];
  return {
    name: knownNames.includes(error?.name) ? error.name : "Error",
    ...(typeof cause?.code === "string" && /^[A-Z_]{1,50}$/.test(cause.code)
      ? { code: cause.code }
      : {}),
    ...(["connect", "getaddrinfo", "read", "write"].includes(cause?.syscall)
      ? { syscall: cause.syscall }
      : {}),
  };
}

export async function fetchInference(url, init, row, checkpoint) {
  for (let attempt = 1; attempt <= 8; attempt++) {
    row.attempts = attempt;
    delete row.failureStage;
    checkpoint();
    try {
      const response = await fetch(url, init);
      row.httpStatus = response.status;
      const requestId = response.headers.get("x-vercel-id");
      if (requestId && /^[\w:.-]{1,200}$/.test(requestId)) row.gatewayRequestId = requestId;
      checkpoint();
      return response;
    } catch (error) {
      if (!failedBeforeConnect(error)) throw error;
      row.failureStage = "before-connect";
      row.connectionFailures ??= [];
      row.connectionFailures.push(failureDetails(error));
      checkpoint();
      if (init.signal.aborted || attempt === 8) throw error;
      await setTimeout(Math.min(1000 * 2 ** (attempt - 1), 10000), undefined, {
        signal: init.signal,
      });
    }
  }
}
