"use server";

import {
  applyOwnerContactImportCandidates,
  type ContactImportCandidateResolution,
} from "@tendnote/db/queries/contacts-import-preview";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";
import { createOwnerContactImportAdapter } from "@/lib/integrations/contact-import-preview-data";

export async function confirmSafeContactImportCandidatesAction(formData: FormData) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    candidateIds: getCandidateIds(formData),
    mode: "safe_bulk",
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  revalidatePath("/account/contacts/import");
  revalidatePath("/people");
  redirect(importFeedbackUrl(result));
}

export async function confirmContactImportCandidateAction(formData: FormData) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    candidateIds: getCandidateIds(formData),
    mode: "explicit",
    resolutions: [getResolution(formData)],
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  revalidatePath("/account/contacts/import");
  revalidatePath("/people");
  redirect(importFeedbackUrl(result));
}

export async function skipContactImportCandidateAction(formData: FormData) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    mode: "explicit",
    resolutions: [{ candidateId: String(formData.get("candidateId") ?? ""), action: "skip" }],
    adapter: await createOwnerContactImportAdapter({ allowFixture: false }),
  });

  revalidatePath("/account/contacts/import");
  redirect(importFeedbackUrl(result));
}

function getCandidateIds(formData: FormData): string[] {
  return formData
    .getAll("candidateId")
    .flatMap((value) => (typeof value === "string" && value ? [value] : []));
}

function getResolution(formData: FormData): ContactImportCandidateResolution {
  const candidateId = String(formData.get("candidateId") ?? "");
  const targetPersonId = String(formData.get("targetPersonId") ?? "").trim();
  const createPerson = formData.get("createPerson") === "true";
  const birthdayChoice = String(formData.get("birthdayChoice") ?? "");

  return {
    candidateId,
    action: "apply",
    targetPersonId: targetPersonId || null,
    createPerson,
    birthdayChoice:
      birthdayChoice === "provider" || birthdayChoice === "existing" || birthdayChoice === "skip"
        ? birthdayChoice
        : undefined,
  };
}

function importFeedbackUrl(result: {
  importedCount: number;
  createdPeople: number;
  updatedPeople: number;
  addedContactMethods: number;
  addedBirthdays: number;
  errorMessage?: string;
}) {
  if (result.errorMessage) {
    return `/account/contacts/import?importError=${encodeURIComponent(result.errorMessage)}`;
  }

  const params = new URLSearchParams({
    confirmed: String(result.importedCount),
    created: String(result.createdPeople),
    updated: String(result.updatedPeople),
    methods: String(result.addedContactMethods),
    birthdays: String(result.addedBirthdays),
  });

  return `/account/contacts/import?${params}`;
}
