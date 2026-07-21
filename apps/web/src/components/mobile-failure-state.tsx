import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MobileFailureKind =
  | "offline"
  | "authentication"
  | "app_server"
  | "eve"
  | "cache_mismatch";

const FAILURE_COPY: Record<MobileFailureKind, { action: string; body: string; heading: string }> = {
  offline: {
    action: "Try again",
    body: "Tendnote needs a connection for current records and every save. Unsaved text stays on this device.",
    heading: "You're offline",
  },
  authentication: {
    action: "Sign in",
    body: "Sign in again to return to the destination you were opening. Nothing was submitted while signed out.",
    heading: "Your session expired",
  },
  app_server: {
    action: "Try again",
    body: "Your records could not be loaded. Unsaved text is still available while you retry.",
    heading: "Tendnote couldn't load",
  },
  eve: {
    action: "Try Eve again",
    body: "Your Tendnote records are still available. This question remains unsaved so you can retry or copy it.",
    heading: "Eve is unavailable",
  },
  cache_mismatch: {
    action: "Refresh safely",
    body: "The app shell and this page are out of sync. Unfinished drafts are preserved before refreshing.",
    heading: "Tendnote needs a refresh",
  },
};

export function MobileFailureState({
  className,
  kind,
  onRetry,
}: {
  className?: string;
  kind: MobileFailureKind;
  onRetry?: () => void;
}) {
  const copy = FAILURE_COPY[kind];
  return (
    <section
      className={cn("flex flex-col items-start gap-3 rounded-xl border bg-surface p-4", className)}
      role="alert"
    >
      <div>
        <h2 className="font-semibold text-[length:var(--text-title)]">{copy.heading}</h2>
        <p className="mt-1 text-muted-foreground text-[length:var(--text-small)]">{copy.body}</p>
      </div>
      {kind === "authentication" ? (
        <Button asChild className="min-h-11" size="lg" variant="outline">
          <Link href="/sign-in">{copy.action}</Link>
        </Button>
      ) : (
        <Button className="min-h-11" onClick={onRetry} size="lg" type="button" variant="outline">
          {copy.action}
        </Button>
      )}
    </section>
  );
}
