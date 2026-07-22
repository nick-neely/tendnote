import Link from "next/link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MobileFailureKind =
  | "offline"
  | "authentication"
  | "app_server"
  | "capture_change"
  | "capture_save"
  | "capture_undo"
  | "eve"
  | "cache_mismatch";

const FAILURE_COPY: Record<MobileFailureKind, { action: string; body: string; heading: string }> = {
  offline: {
    action: "Try again",
    body: "Tendnote needs a connection to load records and save changes. Unsaved text stays on this device.",
    heading: "You're offline",
  },
  authentication: {
    action: "Sign in",
    body: "Sign in again to pick up where you left off. Nothing was saved while you were signed out.",
    heading: "Your session expired",
  },
  app_server: {
    action: "Try again",
    body: "Tendnote couldn't load your records. Unsaved text stays on this device while you retry.",
    heading: "Tendnote couldn't load",
  },
  capture_change: {
    action: "Try change again",
    body: "Tendnote didn't save the change. Your original Saved Item and capture are unchanged.",
    heading: "Change wasn't saved",
  },
  capture_save: {
    action: "Try saving again",
    body: "Nothing was saved. Your text stays on this device so you can retry or copy it.",
    heading: "Capture wasn't saved",
  },
  capture_undo: {
    action: "Try Undo again",
    body: "Tendnote couldn't confirm the undo. Trying again is safe.",
    heading: "Undo wasn't confirmed",
  },
  eve: {
    action: "Try Eve again",
    body: "Your records are safe. Your question is unsaved, so you can retry or copy it.",
    heading: "Eve is unavailable",
  },
  cache_mismatch: {
    action: "Refresh",
    // Reached both when a stale page asks for a shell asset a newer build replaced
    // and when that fetch simply fails offline, so the copy must not diagnose either.
    body: "Tendnote couldn't load part of this page. Your drafts are kept when it refreshes.",
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
