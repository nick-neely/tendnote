import Link from "next/link";
import { connection } from "next/server";
import { AdmittedRoute } from "@/components/admitted-route";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { ContactImportPreviewClient } from "./contact-import-preview-client";

export default function ContactsImportPage() {
  return (
    <AdmittedRoute title="Contact import">
      <ContactsImportContent />
    </AdmittedRoute>
  );
}

async function ContactsImportContent() {
  if (process.env.NODE_ENV !== "test") await connection();
  await requireAdmittedOwner({ returnTo: "/account/contacts/import" });
  return (
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
        </div>
      </header>

      <ContactImportPreviewClient />
    </div>
  );
}
