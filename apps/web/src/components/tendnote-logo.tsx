import { cn } from "@/lib/utils";

/**
 * The selected Tended Memory raster, kept exact rather than redrawn. Light and
 * dark exports share one alpha silhouette; only their palette changes.
 */
export function TendnoteMark({ className, label }: { className?: string; label?: string }) {
  const images = (
    <>
      {/* biome-ignore lint/performance/noImgElement: this exact static brand raster must work outside Next.js runtimes */}
      <img
        alt=""
        aria-hidden
        className="size-full object-contain dark:hidden"
        height={256}
        loading="eager"
        src="/icons/tendnote-mark-light.png"
        width={256}
      />
      {/* biome-ignore lint/performance/noImgElement: this exact static brand raster must work outside Next.js runtimes */}
      <img
        alt=""
        aria-hidden
        className="hidden size-full object-contain dark:block"
        height={256}
        loading="eager"
        src="/icons/tendnote-mark-dark.png"
        width={256}
      />
    </>
  );

  if (label) {
    return (
      <span
        aria-label={label}
        className={cn("relative inline-block shrink-0", className)}
        role="img"
      >
        {images}
      </span>
    );
  }

  return (
    <span aria-hidden className={cn("relative inline-block shrink-0", className)}>
      {images}
    </span>
  );
}

type LogoSize = "header" | "auth";

/**
 * Mark box and matching wordmark size per surface. The wordmark is sized so its
 * cap-height reads at roughly 55–62% of the visible mark (the PNG carries internal
 * padding, so the glyph is smaller than its box): ~17px beside the 28px header
 * mark, ~19px beside the 32px auth mark.
 */
// `leading-none` is paired with the size (and kept AFTER it): tailwind-merge reads
// a bare arbitrary `text-[17px]` as a font-size that could carry a line-height, so a
// `leading-none` placed before it gets dropped. Ordering it last keeps line-height 1.
const LOGO_SIZES: Record<LogoSize, { mark: string; wordmark: string }> = {
  header: { mark: "size-7", wordmark: "text-[17px] leading-none" },
  auth: { mark: "size-8", wordmark: "text-[19px] leading-none" },
};

export function TendnoteLogo({
  className,
  size = "auth",
  markClassName,
  wordmarkClassName,
}: {
  className?: string;
  size?: LogoSize;
  markClassName?: string;
  wordmarkClassName?: string;
}) {
  const sizing = LOGO_SIZES[size];
  return (
    <span className={cn("inline-flex items-center gap-2 text-foreground", className)}>
      <TendnoteMark className={cn(sizing.mark, "shrink-0", markClassName)} />
      {/*
       * Live-text wordmark. Humanist sans (IBM Plex Sans, NOT serif) to pair with
       * the heavy rounded mark; single ink color (text-foreground, NOT sage);
       * semibold with a faint optical tightening. font-sans is explicit so it can
       * never inherit the display serif from an ancestor.
       */}
      <span
        className={cn(
          "font-sans font-semibold tracking-[-0.01em]",
          sizing.wordmark,
          wordmarkClassName,
        )}
      >
        Tendnote
      </span>
    </span>
  );
}
