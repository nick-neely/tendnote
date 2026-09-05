"use client";

import type { PersonUpdateSummary } from "@tendnote/domain";
import Link from "next/link";
import { ArrowRightIcon, RotateCcwIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { PERSON_FIELD_LABEL } from "@/lib/eve/person-fields";
import { titleCase } from "@/lib/person-format";
import { formatPersonUpdateValue, PERSON_UNDO_MESSAGES } from "@/lib/person-update-format";
import { usePersonUpdateUndo } from "./use-person-update-undo";

/** Same authoritative recovery control on the person page and the saved Eve result. */
export function PersonUpdateUndo({
  update,
  inConversation = false,
}: {
  update: PersonUpdateSummary;
  inConversation?: boolean;
}) {
  const { status, pending, error, undo } = usePersonUpdateUndo(update.target);
  const { personId } = update.target;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <dl className="flex min-w-0 flex-col gap-2.5 text-sm">
        {update.changes.map(({ field, before, after }) => (
          <div className="min-w-0" key={field}>
            <dt className="text-xs font-medium text-muted-foreground">
              {titleCase(PERSON_FIELD_LABEL[field] ?? field)}
            </dt>
            <dd className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1 [overflow-wrap:anywhere]">
              <span className="min-w-0 text-muted-foreground">
                {formatPersonUpdateValue(field, before)}
              </span>
              <ArrowRightIcon
                aria-hidden
                className="size-3 shrink-0 self-center text-muted-foreground"
              />
              <span className="sr-only">changed to</span>
              <span className="min-w-0 font-medium">{formatPersonUpdateValue(field, after)}</span>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {status === "available" && (
          <Button
            className="min-h-11"
            disabled={pending}
            onClick={undo}
            size="sm"
            variant="outline"
          >
            <RotateCcwIcon aria-hidden className="size-4" />
            {pending
              ? "Undoing…"
              : error
                ? "Retry undo"
                : inConversation
                  ? "Undo"
                  : "Undo last update"}
          </Button>
        )}
        {inConversation && (
          <Link
            className="inline-flex min-h-11 items-center rounded-md px-2 py-2 text-sm underline underline-offset-4 hover:text-primary focus-visible:outline-2 focus-visible:outline-ring"
            href={`/people/${personId}`}
          >
            View person
          </Link>
        )}
      </div>
      <p aria-atomic="true" className="text-sm text-muted-foreground empty:hidden" role="status">
        {pending ? "Undoing…" : status !== "available" ? PERSON_UNDO_MESSAGES[status] : ""}
      </p>
      {error && (
        <p className="text-sm text-muted-foreground" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
