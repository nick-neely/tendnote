import { describe, expect, it } from "vitest";
import {
  createGeneralActionAssetLinkSchema,
  generalActionAssetLinkSchema,
} from "./general-action-asset-links";

describe("General Action Asset Link provenance", () => {
  const persisted = {
    id: "link-1",
    createdByUserId: null,
    generalActionId: "action-1",
    assetId: "asset-1",
    hintLabel: null,
    assetMemoryId: null,
    createdAt: new Date(),
  };

  it("retains a link after its creator account is deleted", () => {
    expect(generalActionAssetLinkSchema.parse(persisted).createdByUserId).toBeNull();
  });

  it("requires a live actor when a new link is created", () => {
    expect(() =>
      createGeneralActionAssetLinkSchema.parse({
        ...persisted,
        id: undefined,
        createdAt: undefined,
      }),
    ).toThrow();
  });
});
