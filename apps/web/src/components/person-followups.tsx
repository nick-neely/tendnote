"use client";

import { useState } from "react";
import { ActiveFollowupRow } from "@/components/person-followup-active-row";
import { CreateFollowupForm } from "@/components/person-followup-create-form";
import { ResolvedFollowupRow } from "@/components/person-followup-resolved-row";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import type { FollowupView } from "@/lib/followup-view";

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
export function PersonFollowups({
  personId,
  firstName,
  defaultDueDate,
  active,
  resolved,
}: {
  personId: string;
  firstName: string;
  defaultDueDate: string;
  active: FollowupView[];
  resolved: FollowupView[];
}) {
  const [activeList, setActiveList] = useState(active);
  const [resolvedList, setResolvedList] = useState(resolved);

  function removeActive(id: string) {
    setActiveList((current) => current.filter((followup) => followup.id !== id));
  }

  function updateActive(view: FollowupView) {
    setActiveList((current) =>
      sortByDue(current.map((followup) => (followup.id === view.id ? view : followup))),
    );
  }

  function addActive(view: FollowupView) {
    setActiveList((current) => sortByDue([...current, view]));
  }

  function removeResolved(id: string) {
    setResolvedList((current) => current.filter((followup) => followup.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      {activeList.length ? (
        <LedgerList>
          {activeList.map((followup) => (
            <ActiveFollowupRow
              followup={followup}
              key={followup.id}
              onResolve={removeActive}
              onUpdate={updateActive}
            />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          No active follow-ups. Set a reminder to reconnect with {firstName}.
        </LedgerEmpty>
      )}

      <CreateFollowupForm
        defaultDueDate={defaultDueDate}
        firstName={firstName}
        onCreate={addActive}
        personId={personId}
      />

      {resolvedList.length ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Resolved ({resolvedList.length})
          </summary>
          <div className="mt-2">
            <LedgerList>
              {resolvedList.map((followup) => (
                <ResolvedFollowupRow
                  followup={followup}
                  key={followup.id}
                  onReopen={addActive}
                  onResolve={removeResolved}
                />
              ))}
            </LedgerList>
          </div>
        </details>
      ) : null}
    </div>
  );
}
