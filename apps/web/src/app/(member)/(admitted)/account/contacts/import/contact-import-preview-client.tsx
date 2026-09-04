"use client";

import { useState, useTransition } from "react";
import { loadContactImportPreviewAction } from "@/app/actions/contact-import";
import { TriangleAlertIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { ContactImportReview } from "./contact-import-review";

type Preview = Extract<
  Awaited<ReturnType<typeof loadContactImportPreviewAction>>,
  { ok: true }
>["view"];

/** Provider work starts only after explicit owner intent. */
export function ContactImportPreviewClient() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const load = () => {
    startTransition(async () => {
      try {
        const nextPreview = await loadContactImportPreviewAction();
        if (!nextPreview.ok) {
          setError(nextPreview.error);
          return;
        }
        setPreview(nextPreview.view);
        setError(null);
      } catch {
        setError("Contact import preview is unavailable right now. Try again shortly.");
      }
    });
  };

  if (error) return <PreviewError message={error} onRetry={load} pending={pending} />;
  if (!preview) {
    return (
      <section className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-surface px-3.5 py-3">
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-muted-foreground">
          Load a private preview from Google Contacts when you are ready to review it. Nothing is
          imported automatically.
        </p>
        <Button disabled={pending} onClick={load} type="button">
          {pending ? "Loading preview…" : "Load preview"}
        </Button>
      </section>
    );
  }
  if (!preview.connected) {
    return (
      <PreviewError
        message="Connect Google Contacts from Account before starting an import preview."
        onRetry={load}
        pending={pending}
      />
    );
  }
  if (preview.errorMessage) {
    return <PreviewError message={preview.errorMessage} onRetry={load} pending={pending} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button disabled={pending} onClick={load} size="sm" type="button" variant="outline">
          {pending ? "Refreshing…" : "Refresh preview"}
        </Button>
      </div>
      <ContactImportReview
        candidates={preview.candidates}
        fetchedCount={preview.fetchedCount}
        key={preview.id}
      />
    </div>
  );
}

function PreviewError({
  message,
  onRetry,
  pending,
}: {
  message: string;
  onRetry: () => void;
  pending: boolean;
}) {
  return (
    <section
      className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3.5 py-3"
      role="alert"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="flex flex-col items-start gap-2">
        <p className="text-[length:var(--text-body)] leading-[var(--text-body-line)] text-pretty text-destructive">
          {message}
        </p>
        <Button disabled={pending} onClick={onRetry} size="sm" type="button" variant="outline">
          {pending ? "Retrying…" : "Retry"}
        </Button>
      </div>
    </section>
  );
}
