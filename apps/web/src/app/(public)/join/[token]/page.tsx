import { connection } from "next/server";
import { Suspense } from "react";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { JoinInvitationSurface } from "@/components/household/join-invitation-surface";
import { type HouseholdJoinView, resolveHouseholdJoinView } from "@/lib/household/join-view";

/**
 * A capability route, not a destination.
 *
 * It is never linked from inside Tendnote and never appears in navigation: the
 * only way here is an emailed link, and the only thing here is one decision. It
 * deliberately renders no app shell, so the household's management surface is
 * not exposed before acceptance.
 *
 * `noindex` and the `no-referrer` policy (see `next.config.ts`) keep the link out
 * of search indexes and out of any third party's referrer header.
 */
export const metadata = {
  title: "Invitation",
  robots: { index: false, follow: false },
};

const HEADINGS: Record<HouseholdJoinView["state"], { title: string; subtitle: string }> = {
  ready: {
    title: "You're invited",
    subtitle: "Join when you're ready. Nothing is shared until you choose to share it.",
  },
  "sign-in-required": {
    title: "You have an invitation",
    subtitle: "Sign in to see who it's from.",
  },
  "address-mismatch": {
    // Not "Wrong address": the visitor did nothing wrong, and this page has no
    // standing to scold someone it has not identified.
    title: "A different address",
    subtitle: "This invitation belongs to another email address.",
  },
  "workspace-conflict": {
    title: "You already have a household",
    subtitle: "Nothing here has changed.",
  },
  "access-pending": {
    title: "Not quite yet",
    subtitle: "Your Tendnote access is still being set up.",
  },
  unusable: {
    title: "This invitation has closed",
    subtitle: "Nothing was shared, and nothing needs doing.",
  },
};

/**
 * The shell renders immediately; only the part that depends on who is asking
 * waits.
 *
 * Resolving the invitation needs both the session and the token, so it is
 * request-time work by nature. Leaving it unwrapped in the page body would block
 * the whole route from prerendering — on a page whose entire job is to answer one
 * question fast, from an email client, on a phone. Inside a boundary the mark,
 * the frame, and a truthful "checking this invitation" line commit at once, and
 * the answer swaps in underneath.
 *
 * The `params` promise is passed *into* the boundary rather than awaited here.
 * The token is URL data, and the App Shell is shared across every link to this
 * route, so awaiting it above the boundary would tie the shell to one
 * invitation's URL and take the route back out of the instant shell.
 */
export default function JoinInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  return (
    <Suspense fallback={<JoinPending />}>
      <ResolvedInvitation params={params} />
    </Suspense>
  );
}

async function ResolvedInvitation({ params }: { params: Promise<{ token: string }> }) {
  if (process.env.NODE_ENV !== "test") await connection();
  const { token } = await params;
  const secret = decodeURIComponent(token);
  const view = await resolveHouseholdJoinView(secret);
  const copy = HEADINGS[view.state];

  return (
    <AuthScaffold subtitle={copy.subtitle} title={copy.title}>
      <JoinInvitationSurface secret={secret} view={view} />
    </AuthScaffold>
  );
}

/**
 * The fallback promises only what is already true: Tendnote is looking. It names
 * no household and no outcome, so the shell can be served to anyone — including
 * someone holding a link that turns out to be dead.
 */
function JoinPending() {
  return (
    <AuthScaffold subtitle="One moment." title="Checking this invitation">
      <div className="flex flex-col gap-3" aria-hidden>
        <div className="h-4 w-full animate-pulse rounded bg-muted" />
        <div className="h-4 w-3/4 animate-pulse rounded bg-muted" />
        <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      </div>
    </AuthScaffold>
  );
}
