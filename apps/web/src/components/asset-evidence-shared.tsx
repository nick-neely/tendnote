"use client";

import type { AssetEvidenceKind } from "@tendnote/domain";
import {
  BookOpenIcon,
  ExternalLinkIcon,
  FileTextIcon,
  ImageIcon,
  Link2Icon,
  type LucideIcon,
  ReceiptTextIcon,
  ShieldCheckIcon,
  StickyNoteIcon,
  Trash2Icon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { AssetEvidenceView } from "@/lib/asset-evidence-view";
import { useArmedConfirm } from "@/lib/use-armed-confirm";

/**
 * One quiet glyph per Asset Evidence kind, shared by the profile evidence list,
 * the capture form's kind picker, and the review card's evidence strip so a kind
 * reads the same everywhere. Neutral ink — kind is metadata, not state.
 */
export const ASSET_EVIDENCE_KIND_ICONS: Record<AssetEvidenceKind, LucideIcon> = {
  receipt: ReceiptTextIcon,
  photo: ImageIcon,
  manual: BookOpenIcon,
  warranty: ShieldCheckIcon,
  link: Link2Icon,
  note: StickyNoteIcon,
};

/** The compact "kind · size/link · added" metadata line under an evidence label. */
function evidenceMetaLabel(view: AssetEvidenceView): string {
  const parts = [view.kindLabel];
  if (view.sizeLabel) {
    parts.push(view.sizeLabel);
  } else if (view.url) {
    try {
      parts.push(new URL(view.url).hostname);
    } catch {
      // A stored url always parsed once; fall through quietly if it ever doesn't.
    }
  }
  if (view.moneyLabel) {
    parts.push(view.moneyLabel);
  }
  if (view.purchasedOnLabel) {
    parts.push(`bought ${view.purchasedOnLabel}`);
  }
  if (view.renewsOnLabel) {
    parts.push(`renews ${view.renewsOnLabel}`);
  }
  // "Added Jul 13" → "added Jul 13": sentence-cases only the word, not the date.
  parts.push(view.addedLabel.replace(/^Added/, "added"));
  return parts.join(" · ");
}

/**
 * The evidence thumbnail slot: an image preview for uploaded photos/receipts
 * (served by the gated file route, which re-checks visibility per request), or
 * the kind's glyph for PDFs, links, and notes.
 */
function EvidenceThumb({ view }: { view: AssetEvidenceView }) {
  const KindIcon =
    view.hasFile && !view.isImage ? FileTextIcon : ASSET_EVIDENCE_KIND_ICONS[view.kind];
  if (view.isImage && view.fileHref) {
    return (
      // biome-ignore lint/performance/noImgElement: gated, per-user bytes from the visibility-checked file route — next/image optimization would cache/proxy private content.
      <img
        alt=""
        className="size-10 shrink-0 rounded-md border object-cover"
        loading="lazy"
        src={view.fileHref}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="flex size-10 shrink-0 items-center justify-center rounded-md border bg-surface text-muted-foreground"
    >
      <KindIcon className="size-4.5" />
    </span>
  );
}

/**
 * One piece of Asset Evidence at Personal Ledger density: thumbnail or glyph,
 * the human label first, metadata in quiet mono underneath, and — only where
 * they apply — a "Just me" badge for a private record under a broader asset, an
 * open-in-new-tab affordance, and the owner's two-step remove. Removal confirms
 * in place ("Remove?") rather than a modal, backs out on blur or Escape, and
 * arms after a beat so a double-click on the trash icon can never delete.
 */
export function AssetEvidenceRow({
  view,
  showPrivateBadge,
  onRemove,
  removing,
}: {
  view: AssetEvidenceView;
  /** Show the quiet "Just me" cue — for private evidence under a broader asset. */
  showPrivateBadge: boolean;
  /** Owner-only removal; omit to render the row read-only. */
  onRemove?: () => void;
  removing?: boolean;
}) {
  const confirm = useArmedConfirm();
  const openHref = view.fileHref ?? view.url;

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <EvidenceThumb view={view} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate font-medium text-[length:var(--text-body)] leading-[var(--text-body-line)]">
            {view.label}
          </span>
          {showPrivateBadge ? <Badge variant="outline">Just me</Badge> : null}
        </span>
        {/* Wraps rather than truncates: "$42.99 · renews Sep 1, 2026" must
            survive a 390px viewport (#200 review). */}
        <span className="font-mono text-[length:var(--text-caption)] text-muted-foreground">
          {evidenceMetaLabel(view)}
        </span>
        {view.capturedText ? (
          <p className="mt-0.5 line-clamp-3 max-w-[68ch] whitespace-pre-wrap text-pretty text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
            {view.capturedText}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {openHref ? (
          <Button asChild size="icon-sm" variant="ghost">
            <a aria-label={`Open ${view.label}`} href={openHref} rel="noreferrer" target="_blank">
              <ExternalLinkIcon />
            </a>
          </Button>
        ) : null}
        {onRemove ? (
          confirm.confirming ? (
            <Button
              aria-label={`Confirm removing ${view.label}`}
              disabled={removing || !confirm.armed}
              onBlur={confirm.cancel}
              onClick={onRemove}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  confirm.cancel();
                }
              }}
              size="sm"
              variant="destructive"
            >
              {removing ? <Spinner /> : <Trash2Icon />}
              Remove?
            </Button>
          ) : (
            <Button
              aria-label={`Remove ${view.label}`}
              disabled={removing}
              onClick={confirm.begin}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2Icon />
            </Button>
          )
        ) : null}
      </div>
    </div>
  );
}
