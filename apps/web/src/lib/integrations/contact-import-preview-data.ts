import "server-only";

import { findOwnerContactMethodDuplicates } from "@tendnote/db/queries/contact-methods";
import {
  type ContactImportPreviewSession,
  createContactImportPreviewSession,
  createFakeContactImportFuzzyMatcher,
  createFakeContactImportPreviewAdapter,
} from "@tendnote/db/queries/contacts-import-preview";
import { getPerson, searchPeople } from "@tendnote/db/queries/people";
import { isProviderCapabilityConnected } from "@tendnote/db/queries/provider-connections";
import { requireAdmittedOwner } from "@/lib/access/current-access";

/**
 * Owner-scoped Contacts import preview data for Phase 2E #130. This is
 * fixture-backed provider data for the first end-to-end preview path; the shared
 * service returns ephemeral candidate rows and performs no relationship writes.
 */
export async function getOwnerContactImportPreview(input: {
  query?: string;
}): Promise<ContactImportPreviewSession> {
  const ownerUserId = await requireAdmittedOwner();
  return createContactImportPreviewSession(
    { ownerUserId, query: input.query },
    {
      adapter: createFakeContactImportPreviewAdapter(),
      fuzzyMatcher: createFakeContactImportFuzzyMatcher(),
      isProviderCapabilityConnected,
      searchPeople,
      getPerson,
      findOwnerContactMethodDuplicates,
    },
  );
}
