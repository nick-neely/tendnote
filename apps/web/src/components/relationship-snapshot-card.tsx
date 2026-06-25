import { LockIcon } from "lucide-react";
import { Fragment } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { RelationshipSnapshotView } from "@/lib/relationship-snapshot-view";

/**
 * Read-only relationship snapshot card (#17). It shows the generated summary from
 * the shared snapshot-backed read path and routes every correction to the
 * underlying records below — the card never edits snapshot text. On fallback it
 * steps aside and points to the trust-aware sections, which are the source of
 * truth (ADR 0009).
 */
export function RelationshipSnapshotCard({
  view,
  personName,
}: {
  view: RelationshipSnapshotView;
  personName: string;
}) {
  return (
    <Card className="bg-card" id="relationship-snapshot">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle>Relationship snapshot</CardTitle>
            <CardDescription>
              A quick read on your relationship with {personName}, drawn from your own records.
            </CardDescription>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 font-medium text-[length:var(--text-caption)] text-muted-foreground">
            <LockIcon aria-hidden className="size-3" />
            Read-only
          </span>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {view.fallback || view.summary === null ? (
          <p className="text-[length:var(--text-body)] text-muted-foreground leading-[var(--text-body-line)]">
            Your relationship snapshot is being refreshed. Your saved context is just below.
          </p>
        ) : (
          <>
            <p className="max-w-[68ch] whitespace-pre-line text-pretty text-[length:var(--text-body)] leading-[var(--text-body-line)]">
              {view.summary}
            </p>

            <div className="flex flex-col gap-1.5 border-t pt-3">
              {view.corrections.length ? (
                <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                  Drawn from{" "}
                  {view.corrections.map((target, index) => (
                    <Fragment key={target.kind}>
                      {index > 0 ? <span aria-hidden> · </span> : null}
                      <a
                        className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground"
                        href={target.href}
                      >
                        {target.text}
                      </a>
                    </Fragment>
                  ))}
                  . To change anything here, edit those records below.
                </p>
              ) : (
                <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                  Edit the records below to shape what appears here.
                </p>
              )}

              {view.suggestedMemoryCount > 0 ? (
                <p className="text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
                  <a
                    className="font-medium text-foreground underline decoration-foreground/30 underline-offset-4 transition-colors hover:decoration-foreground"
                    href="#needs-review"
                  >
                    {view.suggestedMemoryCount}{" "}
                    {view.suggestedMemoryCount === 1 ? "observation" : "observations"} under review
                  </a>{" "}
                  — kept separate until you confirm.
                </p>
              ) : null}

              {view.generatedAtLabel ? (
                <p className="text-[length:var(--text-caption)] text-muted-foreground leading-[var(--text-caption-line)]">
                  Generated from your records · {view.generatedAtLabel}
                </p>
              ) : null}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
