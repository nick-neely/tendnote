import type { ReactNode } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

import "@/app/globals.css";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Mount a component into the real-browser document and return an explicit cleanup. */
export async function renderInBrowser(ui: ReactNode): Promise<{
  container: HTMLDivElement;
  unmount: () => Promise<void>;
}> {
  const container = document.createElement("div");
  container.style.width = "100%";
  document.body.appendChild(container);
  const root: Root = createRoot(container);

  await act(async () => {
    root.render(ui);
  });

  return {
    container,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
