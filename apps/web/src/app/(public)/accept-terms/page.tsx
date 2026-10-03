import {
  getLatestOwnerDataExportJob,
  ownerHasExportableData,
} from "@tendnote/db/queries/owner-data-export";
import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { acceptUpdatedTermsAction } from "@/app/actions/reacceptance";
import { DeleteAccountButton } from "@/components/account/delete-account-button";
import { OwnerDataExportSection } from "@/components/account/owner-data-export-section";
import { AuthScaffold } from "@/components/auth/auth-scaffold";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { Button } from "@/components/ui/button";
import { getCurrentAccess } from "@/lib/access/current-access";
import { legalDocumentUrl } from "@/lib/public-links";

/**
 * The re-acceptance gate (#614): any signed-in account that owes acceptance of
 * a flagged document version lands here instead of the app, whether it is
 * admitted, pending, Lapsed, or a guest. It shows what changed and asks for
 * acceptance, and keeps the account's exits open without accepting: export
 * when it owns data, Delete, and Sign out, as the pending area offers them.
 *
 * Delete is offered only to an account admission would not admit. A paying
 * account's deletion must also cancel its subscription, which the deletion
 * screen (#619) brings; until then it has no Delete anywhere, gated or not.
 */
export default async function AcceptTermsPage() {
  if (process.env.NODE_ENV !== "test") await connection();
  const access = await getCurrentAccess();

  if (access.state === "unauthenticated") {
    redirect("/sign-in");
  }

  if (access.state !== "reacceptance") {
    redirect("/");
  }

  const exportJob = (await ownerHasExportableData(access.user.id))
    ? await getLatestOwnerDataExportJob(access.user.id)
    : undefined;
  const canDelete = !access.decision.admitted;

  return (
    <AuthScaffold
      title="We've updated our terms"
      subtitle="Read what changed, then accept to keep using Tendnote. Nothing in your account has changed."
    >
      <div className="flex flex-col gap-5">
        {access.documents.map((doc) => (
          <DocumentChanges doc={doc} key={doc.key} />
        ))}

        <form action={acceptUpdatedTermsAction}>
          {access.documents.map((doc) => (
            <input key={doc.key} name={doc.key} type="hidden" value={doc.version} />
          ))}
          <Button className="w-full" type="submit">
            Accept and continue
          </Button>
        </form>

        <section
          aria-labelledby="leave-heading"
          className="flex flex-col gap-3 border-t pt-5 text-left"
        >
          <div className="flex flex-col gap-1">
            <h2
              className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
              id="leave-heading"
            >
              Not ready to accept?
            </h2>
            <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
              {leaveLine(exportJob !== undefined, canDelete)}
            </p>
          </div>
          {exportJob === undefined ? null : <OwnerDataExportSection initialJob={exportJob} />}
          {canDelete ? <DeleteAccountButton email={access.user.email} /> : null}
          <SignOutButton className="w-full" />
        </section>
      </div>
    </AuthScaffold>
  );
}

function DocumentChanges({ doc }: { doc: LegalDocument }) {
  const headingId = `${doc.key}-changes`;

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border bg-surface px-3.5 py-3 text-left"
    >
      <div className="flex flex-col gap-0.5">
        <h2
          className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium"
          id={headingId}
        >
          {doc.title}
        </h2>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Version {doc.version}, effective {formatEffectiveDate(doc.effectiveDate)}
        </p>
      </div>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-[length:var(--text-small)] leading-[var(--text-small-line)]">
        {doc.reacceptance?.changes.map((change) => (
          <li key={change}>{change}</li>
        ))}
      </ul>
      <a
        className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium underline underline-offset-4"
        href={legalDocumentUrl(doc)}
        rel="noreferrer"
        target="_blank"
      >
        Read the full {doc.title}
      </a>
    </section>
  );
}

function leaveLine(canExport: boolean, canDelete: boolean): string {
  const exits = [canExport && "export your data", canDelete && "delete your account", "sign out"]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([^,]+)$/, " or $1");
  return `You can still ${exits} without accepting.`;
}

/** `2026-11-01` as "November 1, 2026", read as a calendar date in no time zone. */
function formatEffectiveDate(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}
