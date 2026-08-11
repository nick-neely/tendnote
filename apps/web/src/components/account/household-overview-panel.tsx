"use client";

import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { useEffect, useRef } from "react";
import {
  HouseholdEndingsPanel,
  type HouseholdGovernanceActions,
  type HouseholdOverviewChange,
  HouseholdOwnerOffer,
} from "@/components/account/household-governance-panel";
import {
  type HouseholdInvitationActions,
  HouseholdInvitationsPanel,
} from "@/components/account/household-invitations-panel";
import {
  HouseholdMemberActions,
  type HouseholdMemberGovernanceActions,
} from "@/components/account/household-member-actions";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL = { owner: "Owner", member: "Member" } as const;
/** Written out per role rather than interpolated, so the article stays correct. */
const ROLE_SENTENCE = {
  owner: "You're an owner here.",
  member: "You're a member here.",
} as const;

/**
 * The calm activation and return surface for one active household: who is in it,
 * the reader's own role, how much of its capacity is spoken for, and the ways in
 * and out of it.
 *
 * The reading order is the argument. A question waiting on the reader comes
 * first, then the people, then what those people hold in common, then the
 * invitations an Owner can send, and only then the exits — leaving and ending
 * are real and reachable, but they are the last thing a household is about, not
 * the first. Capacity is stated as a fact, never
 * as a progress goal to fill; the seat line counts live invitations too, so it
 * never promises room that an outstanding invitation has already claimed.
 *
 * `focusOnMount` is for the one case where this panel replaces the control that
 * summoned it, so keyboard focus would otherwise land on the document body at
 * the moment the task completed.
 *
 * `sharedSections` is where the household's shared *content* goes - its
 * calendars and Event Plans - rather than its membership. It is a slot because
 * that content is read on the server and this panel is a client component; it
 * sits after the invitations and before the exits, because leaving and ending
 * belong last however much else the household grows.
 */
export function HouseholdOverviewPanel({
  focusOnMount = false,
  overview,
  invitationActions,
  governanceActions,
  memberActions,
  sharedSections,
  onOverviewChange,
  onAnnounce,
  contextSection,
}: {
  focusOnMount?: boolean;
  overview: HouseholdOverview;
  invitationActions?: HouseholdInvitationActions;
  governanceActions?: HouseholdGovernanceActions;
  memberActions?: HouseholdMemberGovernanceActions;
  sharedSections?: React.ReactNode;
  onOverviewChange: HouseholdOverviewChange;
  onAnnounce: (message: string) => void;
  /** Household Context, composed on the server. See {@link HouseholdSurface}. */
  contextSection?: React.ReactNode;
}) {
  const identityHeadingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (focusOnMount) identityHeadingRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="household-identity-heading" className="flex flex-col gap-1">
        {/*
          `tabIndex={-1}` makes the heading a focus target without adding it to
          the tab order — it is a landing place after creation, not a control.
        */}
        <h2
          className="text-[length:var(--text-h2)] leading-[var(--text-h2-line)] font-semibold tracking-normal text-balance outline-none focus-visible:ring-3 focus-visible:ring-ring/35"
          id="household-identity-heading"
          ref={identityHeadingRef}
          tabIndex={-1}
        >
          {overview.name}
        </h2>
        {/*
          Who the reader is here, and the one rule that changes for them now
          that they are. Both halves of the sharing boundary sit in a single
          sentence because they are a single idea — what household visibility
          opens, and what it leaves alone. Splitting them into two sentences
          read as two separate promises and made the paragraph the longest thing
          on a screen whose subject is the people below it.
        */}
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {ROLE_SENTENCE[overview.viewerRole]}
          {overview.isSoleMember ? " For now it's just you." : ""} A note, action, or asset can be
          given household visibility so everyone here can read it — anything you don&rsquo;t share
          stays private to you.
        </p>
      </section>

      <HouseholdOwnerOffer
        actions={governanceActions}
        onAnnounce={onAnnounce}
        onOverviewChange={onOverviewChange}
        overview={overview}
      />

      <section aria-labelledby="household-people-heading" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2
            className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
            id="household-people-heading"
          >
            People
          </h2>
          <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            {overview.seats.occupied} of {overview.seats.limit} places taken
          </p>
        </div>

        <ul className="divide-y rounded-xl border bg-surface">
          {overview.members.map((member) => (
            <li
              className="flex min-h-14 flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-3"
              key={member.userId}
            >
              <span className="flex min-w-0 flex-col">
                {/*
                  Role sits with the person rather than at the row's right edge.
                  It is a fact about them, and once some rows carry governance
                  controls and others do not, a right-aligned badge stops lining
                  up down the list — leaving the right edge for actions alone is
                  what keeps the column readable.
                */}
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
                    {member.name}
                  </span>
                  {member.isViewer ? (
                    <span className="shrink-0 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                      You
                    </span>
                  ) : null}
                  {/* Role is text, never a color-only cue (DESIGN.md §6, §8). */}
                  <Badge variant={member.role === "owner" ? "secondary" : "outline"}>
                    {ROLE_LABEL[member.role]}
                  </Badge>
                </span>
                <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                  {member.email}
                </span>
              </span>
              <HouseholdMemberActions
                actions={memberActions}
                member={member}
                onAnnounce={onAnnounce}
                onOverviewChange={onOverviewChange}
              />
            </li>
          ))}
        </ul>
      </section>

      {/*
        What the household holds in common sits with its people, before the
        administrative sections. It is part of what the household *is*; the
        invitations and the exits are things one does to it.
      */}
      {contextSection}

      <HouseholdInvitationsPanel
        actions={invitationActions}
        onAnnounce={onAnnounce}
        onOverviewChange={onOverviewChange}
        overview={overview}
      />

      {sharedSections}

      <HouseholdEndingsPanel
        actions={governanceActions}
        onAnnounce={onAnnounce}
        onOverviewChange={onOverviewChange}
        overview={overview}
      />
    </div>
  );
}
