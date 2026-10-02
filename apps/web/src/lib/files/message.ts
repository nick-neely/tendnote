type AttachmentRef = { id: string; fileName: string };
/** A durable reference, never a signed URL or binary payload, travels with queued/retried turns. */
export function attachmentMessage(text: string, file: AttachmentRef): string {
  const name = file.fileName.replace(/[[\]\\\r\n]/g, " ");
  return `${text.trim() || "Please read this file and summarize it."}\n\n[Attached file: ${name}](/api/files/${file.id})`;
}
export function splitAttachmentMessage(message: string): {
  text: string;
  file: AttachmentRef | null;
} {
  const match = /\n\n\[Attached file: ([^\]\r\n]*)\]\(\/api\/files\/([0-9a-f-]{36})\)$/.exec(
    message,
  );
  return match?.[1] && match[2]
    ? { text: message.slice(0, match.index), file: { id: match[2], fileName: match[1] } }
    : { text: message, file: null };
}
