"use client";

import type { GeneralActionLink } from "@tendnote/domain";
import { LinkIcon, XIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** A link being edited; `url`/`label` are raw strings until submit trims them. */
export type LinkDraft = { url: string; label: string };

function emptyLink(): LinkDraft {
  return { url: "", label: "" };
}

export function toLinkDrafts(links: GeneralActionLink[]): LinkDraft[] {
  return links.map((link) => ({ url: link.url, label: link.label ?? "" }));
}

/**
 * Trims link drafts into the persisted shape, dropping blank rows. Returns the
 * lightweight `{ url, label? }` links the domain accepts — not attachments (ADR
 * 0164). Invalid URLs are left for server-side validation to reject with a message.
 */
export function cleanLinks(drafts: LinkDraft[]): GeneralActionLink[] {
  return drafts
    .map((draft) => ({ url: draft.url.trim(), label: draft.label.trim() }))
    .filter((draft) => draft.url.length > 0)
    .map((draft) => (draft.label ? { url: draft.url, label: draft.label } : { url: draft.url }));
}

/**
 * A small, reusable editor for an Action's lightweight links. Each row is a URL
 * plus an optional label; rows add and remove inline. Kept deliberately minimal —
 * a place to keep a relevant link, not document management (ADR 0164).
 */
export function ActionLinksField({
  links,
  onChange,
}: {
  links: LinkDraft[];
  onChange: (links: LinkDraft[]) => void;
}) {
  function update(index: number, patch: Partial<LinkDraft>) {
    onChange(links.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  function remove(index: number) {
    onChange(links.filter((_, i) => i !== index));
  }

  return (
    <div className="flex flex-col gap-2">
      {links.map((link, index) => (
        <div
          // Links have no id while drafting; index is stable within a session.
          // biome-ignore lint/suspicious/noArrayIndexKey: draft rows are positional.
          key={index}
          className="flex flex-col gap-2 sm:flex-row sm:items-center"
        >
          <Input
            aria-label="Link URL"
            className="sm:flex-1"
            inputMode="url"
            onChange={(event) => update(index, { url: event.target.value })}
            placeholder="https://…"
            type="url"
            value={link.url}
          />
          <div className="flex items-center gap-2">
            <Input
              aria-label="Link label (optional)"
              className="flex-1 sm:w-40"
              onChange={(event) => update(index, { label: event.target.value })}
              placeholder="Label (optional)"
              value={link.label}
            />
            <Button
              aria-label="Remove link"
              onClick={() => remove(index)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </div>
        </div>
      ))}
      <Button
        className="self-start"
        onClick={() => onChange([...links, emptyLink()])}
        size="sm"
        type="button"
        variant="ghost"
      >
        <LinkIcon />
        Add link
      </Button>
    </div>
  );
}
