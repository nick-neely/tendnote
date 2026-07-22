"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createDraftAction } from "@/app/actions/create-draft";

type CreateDraftInput = Parameters<typeof createDraftAction>[0];

/**
 * Shared client hook for the Phase 1G draft entry points (PRD #75, issue #79).
 * Every surface — person page, due follow-up, suggested follow-up review point,
 * brief item — calls the one shared `createDraftAction` through this hook and, on
 * success, routes the user into the persisted draft review flow on the person
 * page. A skipped outcome surfaces a clarification instead of a misleading draft.
 */
export function useCreateDraft() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function create(input: CreateDraftInput) {
    setError(null);
    startTransition(async () => {
      try {
        const result = await createDraftAction(input);
        if (result.outcome === "created") {
          router.push(`/people/${result.personId}#message-drafts`);
          router.refresh();
        } else {
          setError("There isn't enough saved context about this person to draft a message yet.");
        }
      } catch {
        setError("Couldn't start a draft. Try again.");
      }
    });
  }

  return { create, pending, error };
}
