import Link from "next/link";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default function ContactsImportPage() {
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
            href="/account"
          >
            Back to account
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
              Contact import preview
            </h1>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
              Review Google Contacts before saving anything to Tendnote.
            </p>
          </div>
        </header>

        <section className="rounded-lg border bg-surface px-3.5 py-3">
          <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty">
            Google Contacts is connected. The preview list lands here next; importing remains
            explicit, and confirmed Tendnote profile data stays separate from the provider grant.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
