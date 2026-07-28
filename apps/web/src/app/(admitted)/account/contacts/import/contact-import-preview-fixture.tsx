import { TriangleAlertIcon } from "@/components/icons";
import { requireAdmittedOwner } from "@/lib/access/current-access";
import { getOwnerContactImportPreview } from "@/lib/integrations/contact-import-preview-data";
import { ContactImportReview } from "./contact-import-review";
import { RefreshPreviewButton } from "./refresh-preview-button";

/** Test-only projection for the review-model rendering tests. The route itself only
 * loads provider data through an explicit client-triggered server action. */
export async function ContactImportPreviewFixture() {
  try {
    const preview = await getOwnerContactImportPreview(await requireAdmittedOwner());
    if (!preview.connected) {
      return (
        <PreviewMessage message="Connect Google Contacts from Account before starting an import preview." />
      );
    }
    if (preview.errorMessage) return <PreviewMessage message={preview.errorMessage} />;
    return (
      <>
        <RefreshPreviewButton />
        <ContactImportReview
          candidates={preview.candidates}
          fetchedCount={preview.fetchedCount}
          key={preview.id}
        />
      </>
    );
  } catch {
    return (
      <PreviewMessage message="Contact import preview is unavailable right now. Try again shortly." />
    );
  }
}

function PreviewMessage({ message }: { message: string }) {
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
