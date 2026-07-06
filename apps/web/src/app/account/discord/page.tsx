import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  DiscordDeliverySettings,
  type DiscordInstallView,
} from "@/components/account/discord-delivery-settings";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { discordEnvFromProcess, isDiscordConfigured } from "@/lib/auth/social";
import type { DiscordInstallRejectReason } from "@/lib/integrations/discord-install";
import { getOwnerDiscordInstalls } from "@/lib/integrations/discord-install-server";

export const dynamic = "force-dynamic";

const INSTALL_START_PATH = "/api/integrations/discord/install";

/**
 * Human-facing outcome for a returning install callback. Typed exhaustively over
 * every reject reason plus `missing_identity` (the boundary's own fail-closed
 * outcome), so adding a new reason is a compile error until copy exists for it.
 */
const CALLBACK_ERRORS: Record<DiscordInstallRejectReason | "missing_identity", string> = {
  discord_error: "Discord didn't complete the install. Nothing changed — you can try again.",
  unauthenticated: "Your session expired before the install finished. Sign in and try again.",
  invalid_state: "That install link expired or didn't match. Start the install again.",
  owner_mismatch:
    "That install was started from a different account. Start it again while signed in here.",
  missing_guild: "Discord didn't return a server. Pick a server when authorizing, then try again.",
  missing_identity: "Connect your Discord identity on Account first, then install the bot.",
};

function callbackErrorMessage(error: string): string {
  return Object.hasOwn(CALLBACK_ERRORS, error)
    ? CALLBACK_ERRORS[error as DiscordInstallRejectReason | "missing_identity"]
    : "That install didn't complete. Nothing changed.";
}

export default async function DiscordDeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{ installed?: string; error?: string }>;
}) {
  const { installed, error } = await searchParams;

  // Inert when Discord OAuth credentials are not configured server-side — there is
  // nothing to install or configure, so send the owner back to Account.
  if (!isDiscordConfigured(discordEnvFromProcess())) {
    redirect("/account");
  }

  const { discordUserId, installs } = await getOwnerDiscordInstalls();

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
            href="/account"
          >
            Back to account
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
              Discord delivery
            </h1>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Add Tendnote to a Discord server and choose where proactive nudges can land. Delivery
              stays private to you, and Tendnote never sends without your approval.
            </p>
          </div>
        </header>

        {installed ? <InstalledBanner /> : null}
        {error ? <CallbackErrorBanner error={error} /> : null}

        <ServersSection discordUserId={discordUserId} installs={installs} />
      </div>
    </AppShell>
  );
}

/**
 * The owner's installed servers: an install entry point (once their Discord
 * identity is linked) plus either the per-server delivery settings or the
 * identity-required empty state.
 */
function ServersSection({
  discordUserId,
  installs,
}: {
  discordUserId: string | null;
  installs: Awaited<ReturnType<typeof getOwnerDiscordInstalls>>["installs"];
}) {
  const identityConnected = discordUserId !== null;
  const installViews: DiscordInstallView[] = installs.map((install) => ({
    guildId: install.guildId,
    targetChannelId: install.targetChannelId,
    enabled: install.enabled,
  }));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
          Servers
        </h2>
        {identityConnected ? (
          <Button asChild size="sm" variant="outline">
            <a href={INSTALL_START_PATH}>
              {installs.length > 0 ? "Add another server" : "Install to a server"}
            </a>
          </Button>
        ) : null}
      </div>

      {identityConnected ? (
        <DiscordDeliverySettings installs={installViews} />
      ) : (
        <IdentityRequiredNotice />
      )}
    </section>
  );
}

/** Success banner shown when returning from a completed bot install. */
function InstalledBanner() {
  return (
    <section
      className="flex items-start gap-2 rounded-lg border bg-surface px-3.5 py-3"
      role="status"
    >
      <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty">
        Tendnote is installed on this server. Set a delivery channel below to start receiving nudges
        there.
      </p>
    </section>
  );
}

/** Alert banner rendering the human-readable outcome for a failed install callback. */
function CallbackErrorBanner({ error }: { error: string }) {
  return (
    <section
      className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3.5 py-3"
      role="alert"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-accent" />
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-accent">
        {callbackErrorMessage(error)}
      </p>
    </section>
  );
}

/** Empty state shown until the owner links their Discord identity on Account. */
function IdentityRequiredNotice() {
  return (
    <div className="rounded-lg border border-dashed bg-surface px-3.5 py-3">
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
        Connect your Discord identity on{" "}
        <Link className="underline underline-offset-2" href="/account">
          Account
        </Link>{" "}
        first. That link is how an install is attributed to you — until it&rsquo;s in place,
        Tendnote won&rsquo;t record a server against your account.
      </p>
    </div>
  );
}
