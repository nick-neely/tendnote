import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARKETING_URL, SELF_HOSTING_GUIDE_URL } from "@/lib/public-links";
import RegionPage from "./page";

describe("region page", () => {
  it("says where the service operates and links to marketing and self-hosting", () => {
    const html = renderToStaticMarkup(<RegionPage />);

    expect(html).toContain("United States");
    expect(html).toContain(`href="${SELF_HOSTING_GUIDE_URL}"`);
    expect(html).toContain(`href="${MARKETING_URL}"`);
  });
});
