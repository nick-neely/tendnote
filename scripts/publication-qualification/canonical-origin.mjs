import { CANONICAL_ORIGIN, FORMER_ORIGIN, PASS } from "./contract.mjs";
import { describeError } from "./secure-fs.mjs";

/**
 * Read-only HTTPS check for the completed domain prerequisite: the canonical
 * origin has to answer, and the former origin has to hand every reader a
 * permanent redirect to it. Nothing here mutates remote state.
 */

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? response?.headers?.[name] ?? null;
}

function origin(value, label) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") throw new Error(`${label} must use HTTPS.`);
    if (parsed.pathname !== "/" || parsed.search || parsed.hash)
      throw new Error(`${label} must be an origin, not a path.`);
    return parsed;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : `${label} is invalid.`);
  }
}

function blocked(message) {
  return { status: "blocked", blockers: [message] };
}

function checkCanonicalResponse(response, blockers) {
  if (!response || response.status < 200 || response.status >= 300)
    blockers.push(
      `Canonical origin returned ${response?.status ?? "no status"}, not a successful HTTPS response.`,
    );
}

function checkRedirectTarget(location, former, canonical, blockers) {
  try {
    const target = new URL(location, former);
    if (
      target.protocol !== "https:" ||
      target.origin !== canonical.origin ||
      target.pathname !== "/" ||
      target.search ||
      target.hash
    )
      blockers.push(
        `Former origin redirects to ${target.toString()}, not the exact canonical origin.`,
      );
  } catch {
    blockers.push("Former origin Location is not a valid URL.");
  }
}

function checkFormerResponse(response, former, canonical, blockers) {
  const location = responseHeader(response, "location");
  if (![301, 308].includes(response?.status))
    blockers.push(
      `Former origin returned ${response?.status ?? "no status"}; expected a permanent 301 or 308 redirect.`,
    );
  if (!location) blockers.push("Former origin did not provide a redirect Location.");
  else checkRedirectTarget(location, former, canonical, blockers);
  return location;
}

export async function verifyCanonicalOrigin({
  canonicalOrigin = CANONICAL_ORIGIN,
  formerOrigin = FORMER_ORIGIN,
  fetchImpl = globalThis.fetch,
} = {}) {
  let canonical;
  let former;
  try {
    canonical = origin(canonicalOrigin, "canonical origin");
    former = origin(formerOrigin, "former origin");
  } catch (error) {
    return blocked(describeError(error));
  }
  if (typeof fetchImpl !== "function")
    return blocked("No fetch implementation is available for the read-only origin check.");

  let canonicalResponse;
  let formerResponse;
  try {
    canonicalResponse = await fetchImpl(canonical.toString(), {
      method: "GET",
      redirect: "manual",
    });
    formerResponse = await fetchImpl(former.toString(), { method: "GET", redirect: "manual" });
  } catch (error) {
    return blocked(
      `Origin verification failed before both responses were observed: ${describeError(error)}`,
    );
  }

  const blockers = [];
  checkCanonicalResponse(canonicalResponse, blockers);
  const location = checkFormerResponse(formerResponse, former, canonical, blockers);
  return {
    status: blockers.length === 0 ? PASS : "blocked",
    blockers,
    checks: {
      canonical: { url: canonical.toString(), status: canonicalResponse?.status ?? null },
      former: { url: former.toString(), status: formerResponse?.status ?? null, location },
    },
  };
}
