import { resolveBetterAuthBaseUrl } from "@tendnote/auth";
import {
  buildContextFactImportPrompt,
  buildContextFactImportProviderLink,
  CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE,
  contextFactImportProviders,
  MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH,
} from "@tendnote/domain/context-fact-import";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { connection } from "next/server";
import {
  type AssistantHandoffOption,
  ContextFactImportSurface,
} from "@/components/account/context-fact-import-surface";
import { AdmittedRoute } from "@/components/admitted-route";
import { appDestination } from "@/components/app-destinations";
import { Button } from "@/components/ui/button";
import { requireAdmittedOwner } from "@/lib/access/current-access";

/**
 * `from=onboarding` is a closed enum rather than a return URL. The prompt this page
 * builds is handed to a third party, and an owner-supplied redirect target on a
 * surface that opens external tabs is exactly the wrong place for one.
 */
type ImportSearchParams = { from?: string };

const ONBOARDING_RETURN = {
  href: appDestination("onboarding-self-context").route,
  label: "Back to setup",
} as const;

const ABOUT_YOU_RETURN = {
  href: appDestination("account-about-you").route,
  label: "Back to About you",
} as const;

export default function ContextFactImportPage({
  searchParams,
}: {
  searchParams: Promise<ImportSearchParams>;
}) {
  return (
    <AdmittedRoute destination="account-about-you-import">
      <ContextFactImportContent searchParams={searchParams} />
    </AdmittedRoute>
  );
}

export async function ContextFactImportContent({
  searchParams,
}: {
  searchParams: Promise<ImportSearchParams>;
}) {
  if (process.env.NODE_ENV !== "test") await connection();
  const destination = appDestination("account-about-you-import");
  await requireAdmittedOwner({ returnTo: destination.route });

  try {
    const { from } = await searchParams;
    const back = from === "onboarding" ? ONBOARDING_RETURN : ABOUT_YOU_RETURN;
    // The assistant is told where to send the owner back to, so the round trip ends
    // on this page rather than wherever they happen to navigate next.
    const returnUrl = `${resolveBetterAuthBaseUrl()}${destination.route}`;
    const prompt = buildContextFactImportPrompt({ returnUrl });
    const options: AssistantHandoffOption[] = contextFactImportProviders.map((provider) => {
      const link = buildContextFactImportProviderLink(provider, prompt);
      return { id: provider.id, name: provider.name, href: link.href, prefilled: link.prefilled };
    });

    return (
      <ContextFactImportSurface
        backHref={back.href}
        backLabel={back.label}
        blockMarker={"```" + CONTEXT_FACT_IMPORT_BLOCK_LANGUAGE}
        maxTextLength={MAX_CONTEXT_FACT_IMPORT_TEXT_LENGTH}
        options={options}
        prompt={prompt}
      />
    );
  } catch (error) {
    unstable_rethrow(error);
    return <ContextFactImportUnavailable />;
  }
}

function ContextFactImportUnavailable() {
  return (
    <section
      aria-labelledby="context-fact-import-unavailable-heading"
      className="mx-auto flex min-w-0 w-full max-w-2xl flex-col gap-3 rounded-xl border border-dashed bg-surface px-4 py-8"
    >
      <h1
        className="text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium"
        id="context-fact-import-unavailable-heading"
      >
        Import is temporarily unavailable.
      </h1>
      <p className="max-w-[65ch] break-words text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
        Your existing facts are unchanged. You can still add one yourself in About you.
      </p>
      <Button asChild className="min-h-11 w-full sm:w-fit" variant="outline">
        <Link href="/account/about-you">Back to About you</Link>
      </Button>
    </section>
  );
}
