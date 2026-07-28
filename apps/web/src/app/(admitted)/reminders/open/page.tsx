import { resolveReminderDeepLinkTarget } from "@tendnote/db/queries/reminders";
import { reminderRecordKindSchema } from "@tendnote/domain/reminders";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { AdmittedRoute } from "@/components/admitted-route";
import {
  appDestination,
  reminderOpenDeepLink,
  reminderRecordDeepLink,
} from "@/components/app-destinations";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { resolveAccountView } from "@/lib/access/account-summary";
import { getCurrentAccess } from "@/lib/access/current-access";
import { signInPathFor } from "@/lib/auth/return-to";

const reminderTargetSchema = z.object({
  kind: reminderRecordKindSchema,
  id: z.uuid(),
});

type ReminderOpenPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default function ReminderOpenPage(props: ReminderOpenPageProps = {}) {
  return (
    <AdmittedRoute destination="reminder">
      <ReminderOpenContent {...props} />
    </AdmittedRoute>
  );
}

async function reminderReturnTo(searchParams: ReminderOpenPageProps["searchParams"]) {
  const target = reminderTargetSchema.safeParse((await searchParams) ?? {});
  return target.success
    ? reminderOpenDeepLink(target.data.kind, target.data.id)
    : appDestination("reminder").route;
}

export async function ReminderOpenContent({ searchParams }: ReminderOpenPageProps = {}) {
  if (process.env.NODE_ENV !== "test") await connection();
  const target = reminderTargetSchema.safeParse((await searchParams) ?? {});
  const returnTo = await reminderReturnTo(searchParams);
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
    ? await resolveReminderDeepLinkTarget({
        ownerUserId,
        recordKind: target.data.kind,
        recordId: target.data.id,
      })
    : null;
  const deepLink = destination ? reminderRecordDeepLink(destination) : null;
  if (deepLink) redirect(deepLink);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-8 sm:px-6">
      <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-[var(--tracking-heading)]">
        Reminder unavailable
      </h1>
      <p className="max-w-[65ch] text-muted-foreground">
        This reminder may have been completed, removed, or is no longer available to this account.
        Nothing was changed.
      </p>
    </main>
  );
}
