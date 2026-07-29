import type { ReactElement } from "react";

import { fireEvent, render } from "@/test/dom";

/**
 * Render a tree, open every disclosure in it, and hand back the resulting markup.
 *
 * Eve's result cards used to fold on `<details>`, which kept the body in the
 * markup whether the fold was open or shut - so their suites could assert on one
 * `renderToStaticMarkup` string. Those disclosures now compose Radix Collapsible,
 * which only mounts the body while open, so a serialized-markup assertion has to
 * expand first. This keeps that expansion in one place: the tests stay statements
 * about *what a card renders*, not about the fold.
 *
 * Nested folds only mount once their parent opens, so the sweep repeats until no
 * closed trigger is left.
 */
export function renderExpanded(ui: ReactElement): string {
  const { container } = render(ui);

  // Bounded so a fold that somehow refuses to open fails an assertion rather than
  // spinning here.
  for (let pass = 0; pass < 5; pass += 1) {
    const closed = container.querySelectorAll<HTMLElement>(
      '[data-slot="collapsible-trigger"][data-state="closed"]',
    );
    if (closed.length === 0) break;
    for (const trigger of closed) fireEvent.click(trigger);
  }

  return container.innerHTML;
}
