/**
 * Optional account telemetry: the account funnel, its saved operator report,
 * and the one setting that switches the funnel, and third-party error
 * reporting, off.
 */
export {
  recordRequestFunnelStage,
  recordServerFunnelStage,
  suppressRequestFunnelStage,
  sweepAccountFunnelEvents,
} from "./account-telemetry/funnel-writes";
export { isTelemetryOptedOut, setTelemetryOptedOut } from "./account-telemetry/opt-out";
export { readAccountFunnelReport } from "./account-telemetry/report";
