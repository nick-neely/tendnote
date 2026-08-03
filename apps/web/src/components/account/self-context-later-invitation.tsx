import { SelfContextSetupInvitation } from "@/components/account/self-context-setup-invitation";

/** A single calm, non-blocking invitation after the owner skipped setup. */
export function SelfContextLaterInvitation() {
  return (
    <SelfContextSetupInvitation
      description="You can share a few private facts with Eve whenever you’re ready. Nothing is required."
      heading="Want to add a little context?"
      id="self-context-later-invitation"
    />
  );
}
