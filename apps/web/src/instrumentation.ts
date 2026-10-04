import type { Instrumentation } from "next";

/**
 * Server errors Next catches go to GlitchTip through the one allowed
 * diagnostic envelope (#641), when this deployment and the request are
 * eligible. The reporter loads only on the Node.js runtime and only once an
 * error happens, and it hands its work off rather than holding up the error
 * response.
 */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reportServerError } = await import("@/lib/diagnostics/report");
  reportServerError(error, request, context);
};
