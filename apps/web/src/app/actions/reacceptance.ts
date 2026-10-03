"use server";

import { recordAcceptances } from "@tendnote/db/queries/acceptance-records";
import { redirect } from "next/navigation";
import { REACCEPTANCE_PATH } from "@/lib/access/access-state";
import { getCurrentAccess } from "@/lib/access/current-access";

/**
 * Accept the updated documents shown at the re-acceptance gate (#614). The
 * form names the version of each document it showed, and only that exact set
 * is recorded: a version flagged after the page rendered sends the account back
 * to the gate to read it, rather than being recorded against unseen text.
 */
export async function acceptUpdatedTermsAction(formData: FormData): Promise<void> {
  const access = await getCurrentAccess();
  if (access.state === "unauthenticated") redirect("/sign-in");
  if (access.state !== "reacceptance") redirect("/");

  if (!access.documents.every((doc) => formData.get(doc.key) === doc.version)) {
    redirect(REACCEPTANCE_PATH);
  }

  await recordAcceptances({ userId: access.user.id, documents: access.documents });
  redirect("/");
}
