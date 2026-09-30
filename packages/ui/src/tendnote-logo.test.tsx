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

  it("typesets the wordmark in the humanist sans, not the display serif", () => {
    const html = renderToStaticMarkup(<TendnoteLogo />);

    // The wordmark pairs with the heavy rounded mark: sans, single ink, semibold.
    expect(html).toContain("font-sans");
    expect(html).toContain("font-semibold");
    expect(html).not.toContain("font-display");
  });

  it("sizes the mark per surface variant", () => {
    const header = renderToStaticMarkup(<TendnoteLogo size="header" />);
    const auth = renderToStaticMarkup(<TendnoteLogo size="auth" />);

    // Header pairs a 28px mark with a ~17px wordmark; auth a 32px mark with ~19px.
    expect(header).toContain("size-7");
    expect(header).toContain("text-[17px]");
    expect(auth).toContain("size-8");
    expect(auth).toContain("text-[19px]");
  });
});
