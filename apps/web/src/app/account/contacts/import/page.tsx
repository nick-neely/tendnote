import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { TriangleAlertIcon } from "@/components/icons";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getOwnerContactImportPreview } from "@/lib/integrations/contact-import-preview-data";
import { ContactImportReview } from "./contact-import-review";
import { RefreshPreviewButton } from "./refresh-preview-button";

export const dynamic = "force-dynamic";

export default async function ContactsImportPage() {
  const ownerUserId = await requireAdmittedOwner({ returnTo: "/account/contacts/import" });
  const preview = await getOwnerContactImportPreview();

  return (
    <AppShell ownerUserId={ownerUserId}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <Link
            className="self-start text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground underline underline-offset-2"
            href="/account"
          >
            Back to account
          </Link>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex flex-col gap-1">
              <h1 className="text-[length:var(--text-h1)] leading-[var(--text-h1-line)] font-semibold tracking-normal">
                Contact import preview
              </h1>
              <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-pretty text-muted-foreground">
                Review contacts from Google before anything is saved to Tendnote.
              </p>
            </div>
            {preview.connected && !preview.errorMessage ? <RefreshPreviewButton /> : null}
          </div>
        </header>

        {!preview.connected ? (
          <section className="rounded-lg border border-dashed bg-surface px-3.5 py-3">
            <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
              Connect Google Contacts from Account before starting an import preview.
            </p>
          </section>
        ) : preview.errorMessage ? (
          <ImportErrorBanner message={preview.errorMessage} />
        ) : (
          <ContactImportReview
            candidates={preview.candidates}
            fetchedCount={preview.fetchedCount}
            key={preview.id}
          />
        )}
      </div>
    </AppShell>
  );
}

function ImportErrorBanner({ message }: { message: string }) {
  return (
    <section
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3"
      role="alert"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-destructive">
        {message}
      </p>
    </section>
  );
}
