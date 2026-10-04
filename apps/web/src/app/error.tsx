"use client";

import { useEffect } from "react";
import { MobileFailureState } from "@/components/mobile-failure-state";
import { reportBrowserError } from "@/lib/diagnostics/browser";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") console.error(error);
    reportBrowserError(error, "error_boundary");
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md items-center px-5 py-[calc(2rem+env(safe-area-inset-top))]">
      <MobileFailureState className="w-full" kind="app_server" onRetry={reset} />
    </main>
  );
}
