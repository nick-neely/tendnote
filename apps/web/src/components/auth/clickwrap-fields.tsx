"use client";

import type { LegalDocument } from "@tendnote/domain/legal-documents";
import { Fragment, useId } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

/** One hosted legal document as the sign-up form shows it. */
export type ClickwrapDocument = Pick<LegalDocument, "key" | "title" | "version"> & { href: string };

export type ClickwrapState = { documents: boolean; eligible: boolean };

export const UNACCEPTED_CLICKWRAP: ClickwrapState = { documents: false, eligible: false };

export function isClickwrapComplete(state: ClickwrapState): boolean {
  return state.documents && state.eligible;
}

/**
 * Hosted sign-up's clickwrap: accept the Terms of Service and Privacy Policy,
 * and confirm US residency and age. Both are required before either sign-up
 * path (email or GitHub) is offered.
 */
export function ClickwrapFields({
  documents,
  disabled,
  onChange,
  state,
}: {
  documents: readonly ClickwrapDocument[];
  disabled?: boolean;
  onChange: (state: ClickwrapState) => void;
  state: ClickwrapState;
}) {
  const id = useId();

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="sr-only">Terms and eligibility</legend>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={state.documents}
          className="mt-0.5"
          disabled={disabled}
          id={`${id}-documents`}
          onCheckedChange={(checked) => onChange({ ...state, documents: checked === true })}
        />
        <Label className="block font-normal leading-snug" htmlFor={`${id}-documents`}>
          I agree to the{" "}
          {documents.map((doc, index) => (
            <Fragment key={doc.key}>
              {index > 0 ? " and " : null}
              <a
                className="font-medium text-foreground underline underline-offset-4"
                href={doc.href}
                rel="noreferrer"
                target="_blank"
              >
                {doc.title}
              </a>
            </Fragment>
          ))}
          .
        </Label>
      </div>
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={state.eligible}
          className="mt-0.5"
          disabled={disabled}
          id={`${id}-eligible`}
          onCheckedChange={(checked) => onChange({ ...state, eligible: checked === true })}
        />
        <Label className="block font-normal leading-snug" htmlFor={`${id}-eligible`}>
          I live in the United States and I'm 18 or older.
        </Label>
      </div>
    </fieldset>
  );
}
