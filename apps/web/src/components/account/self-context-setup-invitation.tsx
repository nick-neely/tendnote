import Link from "next/link";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

/**
 * The one shape every invitation into Self Context setup takes: a calm aside
 * that names the offer and links into the guided prompts.
 *
 * Two placements share it, and they are deliberately different in kind. Home
 * shows its invitation at most once after a dismissal, so it stays a single
 * quiet nudge. About you keeps its own copy permanently, because the guided
 * prompts are otherwise unreachable once that one nudge is spent - the durable
 * entry point is what makes skipping safe rather than final.
 */
export function SelfContextSetupInvitation({
  actionLabel = "Open setup",
  description,
  heading,
  id,
}: {
  actionLabel?: string;
  description: string;
  heading: string;
  id: string;
}) {
  return (
    <aside
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-self-context-setup-invitation={id}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <h2
          className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
          id={`${id}-heading`}
        >
          {heading}
        </h2>
        <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          {description}
        </p>
      </div>
      <Button asChild className="min-h-11 w-full shrink-0 sm:w-auto" variant="outline">
        <Link href={appDestination("onboarding-self-context").route}>{actionLabel}</Link>
      </Button>
    </aside>
  );
}
