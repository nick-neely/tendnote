import { contextFactImportProviders } from "@tendnote/domain/context-fact-import";
import { SelfContextSetupInvitation } from "@/components/account/self-context-setup-invitation";
import { appDestination } from "@/components/app-destinations";
import { AssistantProviderMark } from "@/components/assistant-provider-marks";

/**
 * The one way into the import round trip, shared by About you and the guided
 * setup so the offer cannot drift into two shapes.
 *
 * It rides the shared Self Context invitation rather than restating its markup,
 * and supplies the three marks as that aside's media row: an owner recognizes the
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
    <SelfContextSetupInvitation
      actionLabel="Bring it over"
      description="Ask ChatGPT, Claude, or Gemini what it remembers about you, paste the answer back, and keep only the parts you want."
      heading="Already told another assistant?"
      href={from ? `${href}?from=${from}` : href}
      id={id}
      media={
        <span className="flex items-center gap-2 pb-0.5 text-muted-foreground">
          {contextFactImportProviders.map((provider) => (
            <AssistantProviderMark className="size-4" key={provider.id} provider={provider.id} />
          ))}
        </span>
      }
    />
  );
}
