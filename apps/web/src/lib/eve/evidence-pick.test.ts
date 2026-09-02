import { ASSET_EVIDENCE_FILE_TYPES_LABEL } from "@tendnote/domain";
import { expect, it } from "vitest";
import { type EvidencePickState, pickEvidenceDrop } from "@/lib/eve/evidence-pick";

/**
 * The one question the capture panel cannot answer for itself: of everything the
 * operating system just handed the composer, which file is *the* file, and what
 * is the user told about the rest. The panel takes one file and vets it with the
 * domain gate; everything here is upstream of that.
 */

const NOTHING: EvidencePickState = { file: null, note: null };

function file(name: string, type: string): File {
  return new File([new Uint8Array(4)], name, { type });
}

const receipt = file("receipt.png", "image/png");
const manual = file("manual.pdf", "application/pdf");
const archive = file("photos.zip", "application/zip");

it("takes the only supported file, with nothing to explain", () => {
  expect(pickEvidenceDrop(NOTHING, { accepted: [receipt], rejected: [] })).toEqual({
    file: receipt,
    note: null,
  });
});

it("takes the first supported file and says the rest were not, when several land at once", () => {
  expect(pickEvidenceDrop(NOTHING, { accepted: [receipt, manual], rejected: [] })).toEqual({
    file: receipt,
    note: "One file at a time. Using the first.",
  });
});

it("counts refused files toward the several, so a mixed drop still explains itself", () => {
  expect(pickEvidenceDrop(NOTHING, { accepted: [receipt], rejected: [archive] })).toEqual({
    file: receipt,
    note: "One file at a time. Using the first.",
  });
});

it("names the kinds it takes when nothing dropped was one of them", () => {
  expect(pickEvidenceDrop(NOTHING, { accepted: [], rejected: [archive] })).toEqual({
    file: null,
    // The domain's own allowlist label, so the note can never promise a type
    // the seam refuses.
    note: `Use a ${ASSET_EVIDENCE_FILE_TYPES_LABEL} file.`,
  });
});

it("keeps the file already in hand rather than letting a drop discard a half-filled capture", () => {
  const held: EvidencePickState = { file: manual, note: null };

  expect(pickEvidenceDrop(held, { accepted: [receipt], rejected: [] })).toEqual({
    file: manual,
    note: "Finish or discard the file you already picked.",
  });
});
