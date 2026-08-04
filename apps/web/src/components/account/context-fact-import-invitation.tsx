import { contextFactImportProviders } from "@tendnote/domain/context-fact-import";
import Link from "next/link";
import { appDestination } from "@/components/app-destinations";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";
import { Button } from "@/components/ui/button";

/**
 * The one way into the import round trip, shared by About you and the guided
 * setup so the offer cannot drift into two shapes.
 *
 * It leads with the three marks rather than a sentence: an owner recognizes the
 * assistants they already use faster than they read a description of them, and
 * that recognition is the whole pitch.
 */
export function ContextFactImportInvitation({
  from,
  id = "context-fact-import-invitation",
}: {
  /** Where the import surface sends the owner back to. */
  from?: "onboarding";
  id?: string;
}) {
  const href = appDestination("account-about-you-import").route;

  return (
    <aside
      aria-labelledby={`${id}-heading`}
      className="flex min-w-0 flex-col gap-3 rounded-xl border bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
      data-context-fact-import-invitation={id}
    >
      <div className="flex min-w-0 flex-col gap-1.5">
        <span className="flex items-center gap-2 text-muted-foreground">
          {contextFactImportProviders.map((provider) => (
            <AssistantProviderMark className="size-4" key={provider.id} provider={provider.id} />
          ))}
        </span>
        <h2
          className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
          id={`${id}-heading`}
        >
          Already told another assistant?
        </h2>
        <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Ask ChatGPT, Claude, or Gemini what it remembers about you, paste the answer back, and
          keep only the parts you want.
        </p>
      </div>
      <Button asChild className="min-h-11 w-full shrink-0 sm:w-auto" variant="outline">
        <Link href={from ? `${href}?from=${from}` : href}>Bring it over</Link>
      </Button>
    </aside>
  );
}
