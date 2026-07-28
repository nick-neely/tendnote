import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePathSpy } from "@/test/action-adapter-mocks";

const {
  archiveGeneralActionArea,
  createGeneralActionArea,
  renameGeneralActionArea,
  unarchiveGeneralActionArea,
} = vi.hoisted(() => ({
  archiveGeneralActionArea: vi.fn(),
  createGeneralActionArea: vi.fn(),
  renameGeneralActionArea: vi.fn(),
  unarchiveGeneralActionArea: vi.fn(),
}));

vi.mock("@tendnote/db/queries/general-action-areas", () => ({
  archiveGeneralActionArea,
  createGeneralActionArea,
  renameGeneralActionArea,
  unarchiveGeneralActionArea,
}));

import {
  archiveGeneralActionAreaAction,
  createGeneralActionAreaAction,
  renameGeneralActionAreaAction,
  unarchiveGeneralActionAreaAction,
} from "./general-action-areas";

const AREA_ID = randomUUID();
const ACTIVE_AREA = {
  id: AREA_ID,
  ownerUserId: "owner-1",
  name: "Home",
  archivedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  createGeneralActionArea.mockResolvedValue(ACTIVE_AREA);
  renameGeneralActionArea.mockResolvedValue(ACTIVE_AREA);
  archiveGeneralActionArea.mockResolvedValue({
    ...ACTIVE_AREA,
    archivedAt: new Date("2026-07-28T03:00:00Z"),
  });
  unarchiveGeneralActionArea.mockResolvedValue(ACTIVE_AREA);
});

describe("General Action Area server adapters", () => {
  it("routes every Area mutation through the admitted owner protocol", async () => {
    await expect(createGeneralActionAreaAction({ name: " Home " })).resolves.toEqual({
      ok: true,
      view: { id: AREA_ID, name: "Home", archived: false },
    });
    await renameGeneralActionAreaAction({ areaId: AREA_ID, name: "Household" });
    await archiveGeneralActionAreaAction({ areaId: AREA_ID });
    await unarchiveGeneralActionAreaAction({ areaId: AREA_ID });

    expect(createGeneralActionArea).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      name: "Home",
    });
    expect(renameGeneralActionArea).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      areaId: AREA_ID,
      name: "Household",
    });
    expect(archiveGeneralActionArea).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      areaId: AREA_ID,
    });
    expect(unarchiveGeneralActionArea).toHaveBeenCalledWith({
      ownerUserId: "owner-1",
      areaId: AREA_ID,
    });
    expect(revalidatePathSpy).toHaveBeenCalledTimes(4);
    expect(revalidatePathSpy).toHaveBeenNthCalledWith(1, "/actions");
  });

  it("returns parse failures as data without calling the Area mutation", async () => {
    await expect(createGeneralActionAreaAction({ name: " " })).resolves.toEqual({
      ok: false,
      error: "Name the area.",
    });

    expect(createGeneralActionArea).not.toHaveBeenCalled();
    expect(revalidatePathSpy).not.toHaveBeenCalled();
  });
});
