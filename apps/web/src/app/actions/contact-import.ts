"use server";

import {
  applyOwnerContactImportCandidates,
  type ContactImportCandidateResolution,
} from "@tendnote/db/queries/contacts-import-preview";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmittedOwnerForAction } from "@/lib/access/current-access";

export async function confirmSafeContactImportCandidatesAction(formData: FormData) {
  const ownerUserId = await requireAdmittedOwnerForAction();
  const result = await applyOwnerContactImportCandidates({
    ownerUserId,
    candidateIds: getCandidateIds(formData),
    mode: "safe_bulk",
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
}) {
  const params = new URLSearchParams({
    confirmed: String(result.importedCount),
    created: String(result.createdPeople),
    updated: String(result.updatedPeople),
    methods: String(result.addedContactMethods),
    birthdays: String(result.addedBirthdays),
  });

  return `/account/contacts/import?${params}`;
}
