import {
  listActiveGeneralActions,
  listResolvedGeneralActions,
} from "@tendnote/db/queries/general-actions";
import { ActionsSurface } from "@/components/actions-surface";
import { AppShell } from "@/components/app-shell";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { toGeneralActionView } from "@/lib/general-action-view";

// A calm cap on the resolved trail — enough to reopen a recent mistake, not a
// backlog to clear (DESIGN.md calm-by-default).
const RESOLVED_LIMIT = 20;

export const dynamic = "force-dynamic";

export default async function ActionsPage() {
  const ownerUserId = await requireAdmittedOwner();
  const now = new Date();
  const [active, resolved] = await Promise.all([
    listActiveGeneralActions({ ownerUserId }),
    listResolvedGeneralActions({ ownerUserId, limit: RESOLVED_LIMIT }),
  ]);

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] font-semibold leading-[var(--text-h1-line)] tracking-normal">
            Actions
          </h1>
          <p className="max-w-[68ch] text-sm text-muted-foreground">
            One-time things to get done that aren't tied to a person. Private to you.
          </p>
        </header>

        <ActionsSurface
          active={active.map((action) => toGeneralActionView(action, now))}
          resolved={resolved.map((action) => toGeneralActionView(action, now))}
          resolvedTruncated={resolved.length >= RESOLVED_LIMIT}
        />
      </div>
    </AppShell>
  );
}
