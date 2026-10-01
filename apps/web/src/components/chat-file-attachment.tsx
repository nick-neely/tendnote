"use client";

import { useState } from "react";
import { AssistantEvidenceCapture } from "@/components/assistant-evidence-capture";
import { PaperclipIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

/** A durable chat reference. Asset saving is explicit and survives transcript replay. */
export function ChatFileAttachment({ id, fileName }: { id: string; fileName: string }) {
  const [capture, setCapture] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/files/${id}`);
      if (!response.ok) throw new Error("This file is no longer available.");
      const blob = await response.blob();
      setCapture(new File([blob], fileName, { type: blob.type }));
    } catch {
      setError("Could not open this file. Try again.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[length:var(--text-small)]">
        <PaperclipIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <a
          className="min-w-0 break-all underline underline-offset-4"
          href={`/api/files/${id}`}
          rel="noopener noreferrer"
          target="_blank"
        >
          {fileName}
        </a>
        <Button
          disabled={loading || capture !== null}
          onClick={save}
          size="sm"
          type="button"
          variant="ghost"
        >
          {loading ? "Opening…" : "Save to an Asset"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-[length:var(--text-small)] text-destructive">
          {error}
        </p>
      ) : null}
      {capture ? (
        <AssistantEvidenceCapture
          uploadedFileId={id}
          file={capture}
          onClose={() => setCapture(null)}
        />
      ) : null}
    </div>
  );
}
