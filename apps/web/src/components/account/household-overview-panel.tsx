"use client";

import type { HouseholdOverview } from "@tendnote/domain/household-overview";
import { useEffect, useRef } from "react";
import {
  type HouseholdInvitationActions,
  HouseholdInvitationsPanel,
} from "@/components/account/household-invitations-panel";
import { Badge } from "@/components/ui/badge";

const ROLE_LABEL = { owner: "Owner", member: "Member" } as const;
/** Written out per role rather than interpolated, so the article stays correct. */
const ROLE_SENTENCE = {
  owner: "You're an owner here.",
  member: "You're a member here.",
} as const;

/**
 * The calm activation and return surface for one active household: who is in it,
 * the reader's own role, and how much of its capacity is spoken for.
 *
 * People lead and controls follow: this is deliberately not the future shared
 * household home, and it renders no settings or lifecycle affordance it cannot
 * honor. Capacity is stated as a fact, never as a progress goal to fill — the
 * seat line counts live invitations too, so it never promises room that an
 * outstanding invitation has already claimed.
 *
 * `focusOnMount` is for the one case where this panel replaces the control that
 * summoned it, so keyboard focus would otherwise land on the document body at
 * the moment the task completed.
 */
export function HouseholdOverviewPanel({
  focusOnMount = false,
  overview,
  invitationActions,
  onOverviewChange,
  onAnnounce,
}: {
  focusOnMount?: boolean;
  overview: HouseholdOverview;
  invitationActions?: HouseholdInvitationActions;
  onOverviewChange: (overview: HouseholdOverview) => void;
  onAnnounce: (message: string) => void;
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
        <p className="max-w-[65ch] text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
          {ROLE_SENTENCE[overview.viewerRole]}
          {overview.isSoleMember ? " For now it's just you." : ""} From here on, a note, action, or
          asset can be given household visibility so everyone here can read it. Anything you
          don&rsquo;t share stays private to you.
        </p>
      </section>

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
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
                    {member.name}
                  </span>
                  {member.isViewer ? (
                    <span className="shrink-0 text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                      You
                    </span>
                  ) : null}
                </span>
                <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                  {member.email}
                </span>
              </span>
              {/* Role is text, never a color-only cue (DESIGN.md §6, §8). */}
              <Badge variant={member.role === "owner" ? "secondary" : "outline"}>
                {ROLE_LABEL[member.role]}
              </Badge>
            </li>
          ))}
        </ul>
      </section>

      <HouseholdInvitationsPanel
        actions={invitationActions}
        onAnnounce={onAnnounce}
        onOverviewChange={onOverviewChange}
        overview={overview}
      />
    </div>
  );
}
