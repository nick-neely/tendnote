import { z } from "zod";
import { getAsset } from "../assets";
import { type ApprovalSubjectDescribers, defineSubject, detail, subject } from "./define";

export const assetApprovalSubjects: ApprovalSubjectDescribers = {
  edit_asset: defineSubject({
    schema: z.object({
      assetId: z.uuid(),
      name: z.string().optional(),
      kind: z.string().optional(),
    }),
    load: (input, ownerUserId) => getAsset({ callerUserId: ownerUserId, assetId: input.assetId }),
    describe: (found, input) =>
      subject(`Rename or refile "${found.name}"`, [
        detail("Filed as", found.kind),
        detail("New name", input.name),
        detail("New kind", input.kind),
      ]),
  }),
};
