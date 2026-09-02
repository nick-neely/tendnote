/**
 * Controls that stay out of the way until you reach for them.
 *
 * A transcript with three buttons under every paragraph reads as a control
 * panel, not a notebook, so the actions row and the queue's per-item controls
 * are invisible until something asks for them. "Something asks for them" has to
 * include the keyboard: a control revealed by hover alone is a button a Tab key
 * can land on and nobody can see, which is exactly what {@link REVEAL_ON_FOCUS}
 * exists to prevent. And where there is no hover at all — a touch screen — they
 * are simply always there.
 */

/**
 * The escape hatches every hover-revealed control needs, and nothing else.
 *
 * Additive on purpose: the AI Elements primitives already ship
 * `opacity-0 … group-hover:opacity-100` against an unnamed `group` ancestor, so
 * a call site only has to add the two focus routes and the coarse-pointer one.
 */
export const REVEAL_ON_FOCUS =
  "focus-visible:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100";

/**
 * The whole reveal, for chrome Tendnote owns, scoped to the `group/turn` a turn
 * puts on itself. Named rather than bare because turns nest other grouped rows
 * inside them and an unnamed group would be claimed by whichever is closest.
 */
export const HOVER_REVEAL =
  "opacity-0 transition-opacity duration-150 ease-(--motion-ease-out) group-hover/turn:opacity-100 group-focus-within/turn:opacity-100 motion-reduce:transition-none [@media(hover:none)]:opacity-100";
