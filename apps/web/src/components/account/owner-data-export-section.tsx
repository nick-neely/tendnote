"use client";

import type { OwnerDataExportJob } from "@tendnote/db/queries/owner-data-export";
import { useState, useTransition } from "react";
import { requestOwnerDataExportAction } from "@/app/actions/owner-data-export";

type OwnerDataExportSectionProps = {
  initialJob: OwnerDataExportJob | null;
};

function stateLabel(status: OwnerDataExportJob["status"] | "idle") {
  switch (status) {
    case "pending":
      return "Waiting to start";
    case "running":
      return "Preparing your export";
    case "completed":
      return "Ready to download";
    case "failed":
      return "Couldn't prepare the export yet";
    case "expired":
      return "Expired — request a new export";
    default:
      return "Not requested";
  }
}

export function OwnerDataExportSection({ initialJob }: OwnerDataExportSectionProps) {
  const [job, setJob] = useState(initialJob);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const status = isPending && !job ? "pending" : (job?.status ?? "idle");
  const canRequest = !isPending && job?.status !== "pending" && job?.status !== "running";
  const downloadHref = job?.status === "completed" ? `/api/account/data-export/${job.id}` : null;

  return (
    <section aria-labelledby="owner-data-export-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2
          id="owner-data-export-heading"
          className="text-[length:var(--text-small)] leading-[var(--text-small-line)] font-medium text-muted-foreground"
        >
          Your data
        </h2>
        <p className="text-[length:var(--text-small)] leading-[var(--text-small-line)] text-muted-foreground">
          Request a temporary copy of your Tendnote data. It expires after 24 hours and is never
          emailed or shared.
        </p>
      </div>
      <div className="flex flex-col gap-3 rounded-lg border bg-surface px-3.5 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[length:var(--text-body)] leading-[var(--text-body-line)] font-medium">
              Data Export
            </span>
            <span
              aria-live="polite"
              className="text-[length:var(--text-small)] text-muted-foreground"
            >
              {stateLabel(status)}
            </span>
          </div>
          {downloadHref ? (
            <a
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted"
              download="tendnote-owner-export.zip"
              href={downloadHref}
            >
              Download ZIP
            </a>
          ) : (
            <button
              className="inline-flex min-h-9 items-center rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canRequest}
              onClick={() => {
                setError(null);
                startTransition(async () => {
                  const result = await requestOwnerDataExportAction();
                  if (result.ok) setJob(result.view);
                  else setError(result.error);
                });
              }}
              type="button"
            >
              {isPending
                ? "Requesting…"
                : job?.status === "failed"
                  ? "Try again"
                  : "Request export"}
            </button>
          )}
        </div>
        {job?.status === "failed" ? (
          <p className="text-[length:var(--text-small)] text-muted-foreground">
            The request stays retryable. Nothing was sent outside Tendnote.
          </p>
        ) : null}
        {job?.status === "expired" ? (
          <p className="text-[length:var(--text-small)] text-muted-foreground">
            The temporary archive was removed. You can request another copy.
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-[length:var(--text-small)] text-destructive">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
