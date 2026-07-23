import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TendnoteLogo, TendnoteMark } from "./tendnote-logo";

describe("TendnoteLogo", () => {
  it("renders one reusable Tended Memory geometry with the Tendnote wordmark", () => {
    const html = renderToStaticMarkup(<TendnoteLogo />);

    expect(html).toContain("Tendnote");
    expect(html).toContain("/icons/tendnote-mark-light.png");
    expect(html).toContain("/icons/tendnote-mark-dark.png");
    expect(html).toContain("dark:hidden");
    expect(html).toContain("dark:block");
  });

  it("stays decorative beside the wordmark and can label a standalone mark", () => {
    const logo = renderToStaticMarkup(<TendnoteLogo />);
    const standalone = renderToStaticMarkup(<TendnoteMark label="Tendnote" />);

    expect(logo).not.toContain('role="img"');
    expect(standalone).toContain('aria-label="Tendnote"');
    expect(standalone).toContain('role="img"');
  });
});
