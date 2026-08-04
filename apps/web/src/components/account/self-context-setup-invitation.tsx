import Link from "next/link";
import type { ReactNode } from "react";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";

/**
 * The one shape every invitation into Self Context takes: a calm aside that names
 * the offer and links into it.
 *
 * Three placements share it, and they are deliberately different in kind. Home
 * shows its invitation at most once after a dismissal, so it stays a single
 * quiet nudge. About you keeps its own copy permanently, because the guided
 * prompts are otherwise unreachable once that one nudge is spent - the durable
 * entry point is what makes skipping safe rather than final. The assistant
 * import offer passes its own `href` and leads with the provider marks, since an
 * owner recognizes the assistants they already use faster than they read a
 * sentence about them.
 */
export function SelfContextSetupInvitation({
  actionLabel = "Open setup",
  description,
  heading,
  href = appDestination("onboarding-self-context").route,
  id,
  media,
}: {
  actionLabel?: string;
  description: string;
  heading: string;
  /** Where the offer leads. Defaults to the guided prompts. */
  href?: string;
  id: string;
  /** Optional mark or glyph row above the heading. */
  media?: ReactNode;
}) {
  return (
    <aside
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-self-context-setup-invitation={id}
    >
      <div className="flex min-w-0 flex-col gap-1">
        {media}
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
        <Link href={href}>{actionLabel}</Link>
      </Button>
    </aside>
  );
}
