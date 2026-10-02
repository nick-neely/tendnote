"use client";
import { assertAssetEvidenceFileAccepted } from "@tendnote/domain";
import { upload } from "@vercel/blob/client";

export type UploadedFile = { id: string; fileName: string; mimeType: string; sizeBytes: number };
export async function uploadFile(
  file: File,
  onProgress?: (percentage: number) => void,
): Promise<UploadedFile> {
  assertAssetEvidenceFileAccepted({ mimeType: file.type, sizeBytes: file.size });
  const reservation = await fetch("/api/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }),
  });
  if (!reservation.ok) throw new Error("Could not start the upload. Try again.");
  const { id, pathname } = (await reservation.json()) as { id: string; pathname: string };
  try {
    await upload(pathname, file, {
      access: "private",
      handleUploadUrl: "/api/files/upload",
      clientPayload: id,
      contentType: file.type,
      onUploadProgress: (progress) => onProgress?.(progress.percentage),
    });
    const confirmed = await fetch(`/api/files/${id}`, { method: "POST" });
    if (!confirmed.ok) throw new Error("This file could not be verified. Try a different file.");
    return (await confirmed.json()) as UploadedFile;
  } catch (error) {
    await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => {});
    throw error;
  }
}

/** Shared by every Asset capture surface; the server action receives only an owned id. */
async function uploadEvidenceForm(form: FormData) {
  const file = form.get("file");
  if (file instanceof File && file.size > 0) {
    const uploaded = await uploadFile(file);
    form.delete("file");
    form.set("uploadedFileId", uploaded.id);
  }
  return form;
}

/** Asset storage owns its own copy and lifecycle; retire the temporary browser upload. */
export async function submitEvidenceForm<T extends { ok: boolean }>(
  form: FormData,
  submit: (form: FormData) => Promise<T>,
): Promise<T> {
  const temporary = form.get("file") instanceof File;
  const uploaded = await uploadEvidenceForm(form);
  try {
    return await submit(uploaded);
  } finally {
    const id = uploaded.get("uploadedFileId");
    if (temporary && typeof id === "string")
      await fetch(`/api/files/${id}`, { method: "DELETE" }).catch(() => {});
  }
}
