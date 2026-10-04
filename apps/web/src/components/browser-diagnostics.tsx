"use client";

import { useEffect } from "react";
import { reportBrowserError } from "@/lib/diagnostics/browser";

/** Reports errors no boundary caught: a throwing event handler or an unhandled rejection. */
export function BrowserDiagnostics() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => reportBrowserError(event.error, "window_error");
    const onRejection = (event: PromiseRejectionEvent) =>
      reportBrowserError(event.reason, "unhandled_rejection");
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);
  return null;
}
