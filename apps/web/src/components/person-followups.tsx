"use client";

import { useRouter } from "next/navigation";
import { useRef } from "react";
import { ChevronDownIcon } from "@/components/icons";
import { ActiveFollowupRow } from "@/components/person-followup-active-row";
import {
  CreateFollowupForm,
  type ShareableHouseholdMember,
} from "@/components/person-followup-create-form";
import { ResolvedFollowupRow } from "@/components/person-followup-resolved-row";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { FollowupView } from "@/lib/followup-view";
import { acceptMutationRevision } from "@/lib/mutation-revision";
import {
  type ReversibleMutationApplyPhase,
  ReversibleMutationProvider,
} from "@/lib/reversible-mutation";
import { reconcileRevisionedItems, useServerSyncedList } from "@/lib/use-server-synced-list";

const followupId = (followup: FollowupView) => followup.id;
const followupRevision = (followup: FollowupView) => followup.revision;

function sortByDue(followups: FollowupView[]): FollowupView[] {
  return [...followups].sort((a, b) => a.dueAtISO.localeCompare(b.dueAtISO));
}

/**
 * The person profile's active follow-up management surface (issue #44). Active
 * reminders (open/snoozed) lead; a quiet "Resolved" list keeps recently done or
 * dismissed reminders reachable for reopen without becoming a task inbox. Every
 * mutation flows through the shared owner-scoped lifecycle via server actions.
 * Suggested follow-ups are not shown here — they stay in review surfaces until
 * accepted (#47/#48). The individual rows and create form live in sibling modules;
 * this component owns the optimistic active/resolved list state that ties them
 * together.
 */
export function PersonFollowups({ ...props }: Parameters<typeof PersonFollowupsContent>[0]) {
  return (
    <ReversibleMutationProvider>
      <PersonFollowupsContent {...props} />
    </ReversibleMutationProvider>
  );
}

function PersonFollowupsContent({
  personId,
  firstName,
  defaultDueDate,
  shareableMembers = [],
  active,
  resolved,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  shareableMembers?: ShareableHouseholdMember[];
  active: FollowupView[];
  resolved: FollowupView[];
}) {
  const router = useRouter();
  const acknowledgedRevisions = useRef(new Map<string, string>());
  const displacedPositions = useRef(
    new Map<string, { list: "active" | "resolved"; index: number }>(),
  );
  // Server-synced so an accept in the suggested-follow-ups section above (which
  // promotes a suggestion to an active reminder and refreshes) shows up here
  // instantly, and a completed reminder lands in Resolved — without losing the
  // local optimistic edits these handlers make.
  const [activeList, setActiveList] = useServerSyncedList(
    active,
    followupId,
    sortByDue,
    followupRevision,
  );
  const [resolvedList, setResolvedList] = useServerSyncedList(
    resolved,
    followupId,
    undefined,
    followupRevision,
  );

  // fallow-ignore-next-line complexity -- One reconciliation point moves a revisioned row between the two authoritative lifecycle lists without competing effects.
  function updateFollowup(
    view: FollowupView,
    phase: ReversibleMutationApplyPhase = "authoritative",
  ) {
    if (phase === "projection") displacedPositions.current.delete(view.id);
    if (!acceptMutationRevision(acknowledgedRevisions.current, view, phase)) return false;
    const activeDestination = view.status === "open" || view.status === "snoozed";
    const resolvedDestination = view.status === "completed" || view.status === "dismissed";
    setActiveList((current) =>
      activeDestination
        ? sortByDue(restorePosition(current, view, "active"))
        : removeAndRemember(current, view, "active"),
    );
    setResolvedList((current) =>
      resolvedDestination
        ? restorePosition(current, view, "resolved")
        : removeAndRemember(current, view, "resolved"),
    );
    router.refresh();
    return true;
  }

  function removeAndRemember(
    current: FollowupView[],
    view: FollowupView,
    list: "active" | "resolved",
  ) {
    const index = current.findIndex((item) => item.id === view.id);
    if (index >= 0 && !displacedPositions.current.has(view.id)) {
      displacedPositions.current.set(view.id, { list, index });
    }
    return current.filter((item) => item.id !== view.id || item.revision > view.revision);
  }

  function restorePosition(
    current: FollowupView[],
    view: FollowupView,
    list: "active" | "resolved",
  ) {
    const reconciled = reconcileRevisionedItems(current, [view], followupId, followupRevision);
    const displaced = displacedPositions.current.get(view.id);
    if (!displaced || displaced.list !== list) return reconciled;
    displacedPositions.current.delete(view.id);
    const without = reconciled.filter((item) => item.id !== view.id);
    const index = Math.min(displaced.index, without.length);
    return [...without.slice(0, index), view, ...without.slice(index)];
  }

  function finalizeMutation(id: string) {
    window.setTimeout(() => displacedPositions.current.delete(id), 0);
  }

  function addActive(view: FollowupView) {
    setActiveList((current) => sortByDue([...current, view]));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      {activeList.length ? (
        <LedgerList>
          {activeList.map((followup) => (
            <ActiveFollowupRow
              followup={followup}
              key={followup.id}
              onMutationFinalize={finalizeMutation}
              onUpdate={updateFollowup}
              personId={personId}
            />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>No active follow-ups for {firstName}.</LedgerEmpty>
      )}

      <CreateFollowupForm
        defaultDueDate={defaultDueDate}
        firstName={firstName}
        onCreate={addActive}
        personId={personId}
        shareableMembers={shareableMembers}
      />

      {resolvedList.length ? (
        <Collapsible className="flex flex-col gap-2">
          {/* Matches the Action shelves' disclosure: `min-h-11` is the 44px touch
              target, and the chevron is the affordance the old `list-none`
              summary threw away, which left it reading as a footer caption. */}
          <CollapsibleTrigger className="group -mx-1.5 flex min-h-11 w-fit items-center gap-1.5 rounded-lg px-1.5 text-left text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
            <ChevronDownIcon
              aria-hidden
              className="size-3.5 shrink-0 transition-transform duration-150 ease-(--motion-ease-out) group-data-[state=open]:rotate-180"
            />
            Resolved ({resolvedList.length})
          </CollapsibleTrigger>
          <CollapsibleContent>
            <LedgerList>
              {resolvedList.map((followup) => (
                <ResolvedFollowupRow
                  followup={followup}
                  key={followup.id}
                  onMutationFinalize={finalizeMutation}
                  onUpdate={updateFollowup}
                />
              ))}
            </LedgerList>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  );
}
