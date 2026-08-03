import Link from "next/link";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

/** A single calm, non-blocking invitation after the owner skipped setup. */
export function SelfContextLaterInvitation() {
  return (
    <aside
      aria-labelledby="self-context-later-invitation-heading"
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-self-context-later-invitation
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
          id="self-context-later-invitation-heading"
        >
          Want to add a little context?
        </h2>
        <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          You can share a few private facts with Eve whenever you&rsquo;re ready. Nothing is
          required.
        </p>
      </div>
      <Button asChild className="min-h-11 w-full shrink-0 sm:w-auto" variant="outline">
        <Link href={appDestination("onboarding-self-context").route}>Open setup</Link>
      </Button>
    </aside>
  );
}
