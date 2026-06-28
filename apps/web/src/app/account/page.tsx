import { CalendarIcon, CheckIcon, MailIcon, UsersRoundIcon } from "lucide-react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Badge } from "@/components/ui/badge";
import { localFallbackOwnerUserId } from "@/lib/access/access-state";
import { resolveAccountView } from "@/lib/access/account-summary";
import { getCurrentAccess } from "@/lib/access/current-access";

export const dynamic = "force-dynamic";

// Future integration affordances are disabled-only in Phase 2A: they create no
// provider authorization and no status tables (that is Phase 2B).
const FUTURE_INTEGRATIONS = [
  { icon: CalendarIcon, label: "Google Calendar" },
  { icon: MailIcon, label: "Gmail" },
  { icon: UsersRoundIcon, label: "Google Contacts" },
] as const;

export default async function AccountPage() {
  const access = await getCurrentAccess();
  const view = resolveAccountView(
    access,
    localFallbackOwnerUserId({
      nodeEnv: process.env.NODE_ENV,
      devOwnerUserId: process.env.TENDNOTE_DEV_OWNER_USER_ID,
    }),
  );

  if (view.type === "redirect") {
    redirect(view.to);
  }

  const initial = view.name.trim().charAt(0).toUpperCase() || "?";

  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-1">
          <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
            Account
          </h1>
          <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Your identity and access. Tendnote keeps this deliberately small.
          </p>
        </header>

        {/* Identity */}
        <section className="flex items-center gap-3">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-secondary text-[length:var(--text-title)] font-medium text-secondary-foreground"
          >
            {initial}
          </span>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-[length:var(--text-title)] leading-[var(--text-title-line)] font-medium">
              {view.name}
            </span>
            {view.name !== view.email ? (
              <span className="truncate text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                {view.email}
              </span>
            ) : null}
          </div>
        </section>

        {/* Access status */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
            Access
          </h2>
          <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface px-3.5 py-3">
            <div className="flex min-w-0 flex-col">
              <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)]">
                Private Beta Access
              </span>
              <span className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
                {view.sourceLabel}
              </span>
            </div>
            <Badge>
              <CheckIcon aria-hidden data-icon="inline-start" />
              Active
            </Badge>
          </div>
        </section>

        {/* Future integrations — disabled affordances only (Phase 2B). */}
        <section className="flex flex-col gap-3">
          <h2 className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground">
            Integrations
          </h2>
          <ul className="flex flex-col divide-y rounded-lg border bg-surface">
            {FUTURE_INTEGRATIONS.map(({ icon: Icon, label }) => (
              <li className="flex items-center justify-between gap-3 px-3.5 py-3" key={label}>
                <span className="flex items-center gap-2.5 text-[length:var(--text-body)] leading-[var(--text-body-line)] text-muted-foreground">
                  <Icon aria-hidden className="size-4 shrink-0" />
                  {label}
                </span>
                <Badge variant="outline">Coming soon</Badge>
              </li>
            ))}
          </ul>
          <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
            Calendar, Gmail, and Contacts connect later, each with its own narrow permission and
            your explicit approval.
          </p>
        </section>

        {/* Sign out */}
        <section className="flex flex-col gap-3 border-t pt-6">
          <SignOutButton className="w-full sm:w-auto sm:self-start" />
        </section>
      </div>
    </AppShell>
  );
}
