"use client";

import { useRouter } from "next/navigation";
import { CreateActionForm } from "@/components/general-action-create-form";
import { ResolvedActionRow } from "@/components/general-action-resolved-row";
import { ActionRow } from "@/components/general-action-row";
import { LedgerEmpty, LedgerList } from "@/components/person-ledger";
import type { GeneralActionView } from "@/lib/general-action-view";
import { useServerSyncedList } from "@/lib/use-server-synced-list";

const actionId = (action: GeneralActionView) => action.id;

/** The moment an active action next wants attention; unscheduled sorts last. */
function surfacingKey(action: GeneralActionView): string | null {
  if (action.surfaceState === "deferred") {
    return action.deferUntilISO;
  }
  return action.dueAtISO;
}

function sortActive(actions: GeneralActionView[]): GeneralActionView[] {
  return [...actions].sort((a, b) => {
    const aKey = surfacingKey(a);
    const bKey = surfacingKey(b);
    if (aKey && bKey) {
      return aKey.localeCompare(bKey);
    }
    if (aKey) {
      return -1;
    }
    if (bKey) {
      return 1;
    }
    return 0;
  });
}

/**
 * The private Actions surface: a capture-first create form leading the owner's
 * active one-time Actions, with a quiet "Resolved" list keeping completed and
 * dismissed ones reachable for reopen without becoming a task inbox (DESIGN.md
 * calm-by-default). Every mutation flows through the shared owner-scoped lifecycle
 * via server actions; this component owns the optimistic active/resolved list
 * state that ties the rows and create form together (mirrors PersonFollowups).
 */
export function ActionsSurface({
  active,
  resolved,
  resolvedTruncated = false,
}: {
  active: GeneralActionView[];
  resolved: GeneralActionView[];
  /** The initial resolved load hit the server cap, so older ones aren't shown. */
  resolvedTruncated?: boolean;
}) {
  const router = useRouter();
  const [activeList, setActiveList] = useServerSyncedList(active, actionId, sortActive);
  const [resolvedList, setResolvedList] = useServerSyncedList(resolved, actionId);

  function removeActive(id: string) {
    setActiveList((current) => current.filter((action) => action.id !== id));
    router.refresh();
  }

  function updateActive(view: GeneralActionView) {
    setActiveList((current) =>
      sortActive(current.map((action) => (action.id === view.id ? view : action))),
    );
    router.refresh();
  }

  function addActive(view: GeneralActionView) {
    setActiveList((current) => sortActive([view, ...current.filter((a) => a.id !== view.id)]));
    router.refresh();
  }

  function removeResolved(id: string) {
    setResolvedList((current) => current.filter((action) => action.id !== id));
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <CreateActionForm onCreate={addActive} />

      {activeList.length ? (
        <LedgerList>
          {activeList.map((action) => (
            <ActionRow
              action={action}
              key={action.id}
              onResolve={removeActive}
              onUpdate={updateActive}
            />
          ))}
        </LedgerList>
      ) : (
        <LedgerEmpty>
          Nothing on your plate. Add an action above — something to do that isn't tied to a person,
          like replacing a filter or renewing a subscription.
        </LedgerEmpty>
      )}

      {resolvedList.length ? (
        <details className="group">
          {/* No count on purpose: a tally of things you've finished is still a
              number pulling for attention, and the register keeps this surface
              free of counts and badges. The disclosure alone is enough. */}
          <summary className="cursor-pointer list-none text-[length:var(--text-small)] text-muted-foreground transition-colors hover:text-foreground">
            Resolved
          </summary>
          <div className="mt-2">
            <LedgerList>
              {resolvedList.map((action) => (
                <ResolvedActionRow
                  action={action}
                  key={action.id}
                  onReopen={addActive}
                  onResolve={removeResolved}
                />
              ))}
            </LedgerList>
            {resolvedTruncated && resolvedList.length >= resolved.length ? (
              <p className="mt-2 px-1 text-[length:var(--text-caption)] text-muted-foreground">
                Showing your most recently resolved actions.
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}
