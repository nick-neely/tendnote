import { cn } from "@/lib/utils";

/**
 * What a surface shows while a file is being dragged over it.
 *
 * Decoration, not content: it is `aria-hidden` and `pointer-events-none`, so it
 * neither joins the accessibility tree nor becomes a drag target of its own (an
 * overlay that took the pointer would fire a `dragenter`/`dragleave` pair the
 * moment it appeared, and flicker itself back off). The keyboard path to the
 * same capture is the composer's "+" menu, which is unaffected by any of this.
 *
 * Hairline dashed sage inset from the surface edge, over a scrim in the panel's
 * own tone. The scrim is opaque rather than translucent: at any alpha that let
 * the conversation through, the transcript's own headings sat *inside* the two
 * lines of copy and both became harder to read than either alone. It is on
 * screen only while a file is over the surface, so nothing is hidden for longer
 * than the gesture. No icon tile: the two lines are the whole message, and a
 * glyph above them would be decoration standing where the first thing to read
 * should be (DESIGN.md §Empty States).
 */
export function DropOverlay({
  className,
  hint,
  title,
}: {
  className?: string;
  /** One line saying what happens to the file. */
  hint: string;
  /** The instruction, e.g. "Drop to attach". */
  title: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 z-20 flex animate-in bg-panel p-2 fade-in duration-200 motion-reduce:animate-none",
        className,
      )}
    >
      <div className="flex flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-primary border-dashed px-6 text-center">
        <p className="font-medium text-sm">{title}</p>
        <p className="max-w-[42ch] text-balance text-[length:var(--text-small)] text-muted-foreground leading-[var(--text-small-line)]">
          {hint}
        </p>
      </div>
    </div>
  );
}
