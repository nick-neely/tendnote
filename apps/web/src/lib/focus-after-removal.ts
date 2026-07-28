"use client";

/** Captures logical focus fallbacks before a row is removed from the DOM. */
export function captureFocusAfterRemoval(
  row: HTMLElement | null | undefined,
  headingSelector = "h1, h2, h3",
  fallbackTarget?: () => HTMLElement | null,
): () => void {
  const parent = row?.parentElement;
  const rowIndex = row && parent ? Array.from(parent.children).indexOf(row) : -1;
  const sibling = row?.nextElementSibling ?? row?.previousElementSibling;
  const siblingTarget = sibling?.querySelector<HTMLElement>("a, button, [tabindex]");
  const heading = row?.closest("section, main")?.querySelector<HTMLElement>(headingSelector);
  return () => {
    function focusAfterCommit(attempt: number) {
      const currentSibling =
        rowIndex >= 0 && parent?.isConnected
          ? (parent.children.item(rowIndex) ?? parent.children.item(rowIndex - 1))
          : null;
      if (currentSibling === row && !siblingTarget?.isConnected && attempt === 0) {
        requestAnimationFrame(() => focusAfterCommit(1));
        return;
      }
      const currentTarget =
        currentSibling === row
          ? siblingTarget
          : currentSibling?.querySelector<HTMLElement>("a, button, [tabindex]");
      if (currentTarget?.isConnected) {
        currentTarget.focus();
      } else if (heading?.isConnected) {
        heading.tabIndex = -1;
        heading.focus();
      } else {
        fallbackTarget?.()?.focus();
      }
    }
    requestAnimationFrame(() => focusAfterCommit(0));
  };
}
