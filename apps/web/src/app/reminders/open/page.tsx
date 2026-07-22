import { resolveReminderDeepLink } from "@tendnote/db/queries/reminders";
import { reminderRecordKindSchema } from "@tendnote/domain/reminders";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppShell } from "@/components/app-shell";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { resolveAccountView } from "@/lib/access/account-summary";
import { getCurrentAccess } from "@/lib/access/current-access";
import { signInPathFor } from "@/lib/auth/return-to";

export const dynamic = "force-dynamic";

const reminderTargetSchema = z.object({
  kind: reminderRecordKindSchema,
  id: z.uuid(),
});

export default async function ReminderOpenPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
} = {}) {
  const target = reminderTargetSchema.safeParse((await searchParams) ?? {});
  const returnTo = target.success
    ? `/reminders/open?kind=${encodeURIComponent(target.data.kind)}&id=${encodeURIComponent(target.data.id)}`
    : "/reminders/open";
  const access = await getCurrentAccess();
  const fallbackOwnerUserId = localFallbackOwnerUserId({
    nodeEnv: process.env.NODE_ENV,
    devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
  });
  const view = resolveAccountView(access, fallbackOwnerUserId);
  if (view.type === "redirect") {
    redirect(view.to === "/sign-in" ? signInPathFor(returnTo) : view.to);
  }
  const ownerUserId = access.state === "admitted" ? access.user.id : fallbackOwnerUserId;
  if (!ownerUserId) redirect(signInPathFor(returnTo));

  const destination = target.success
    ? await resolveReminderDeepLink({
        ownerUserId,
        recordKind: target.data.kind,
        recordId: target.data.id,
      })
    : null;
  if (destination) redirect(destination);

  return (
    <AppShell ownerUserId={ownerUserId}>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 sm:px-6">
        <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-[var(--tracking-heading)]">
          Reminder unavailable
        </h1>
        <p className="max-w-[65ch] text-muted-foreground">
          This reminder may have been completed, removed, or is no longer available to this account.
          Nothing was changed.
        </p>
      </main>
    </AppShell>
  );
}
