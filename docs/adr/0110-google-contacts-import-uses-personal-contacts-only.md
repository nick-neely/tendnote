# Google Contacts Import Uses Personal Contacts Only

Phase 2E should import from the owner's personal Google Contacts only, using the narrowest practical People API permission for user-owned contact data. Tendnote should not request Directory, Admin, broad organization, or inferred-contact scopes in the first slice, and should avoid importing "other contacts" unless the provider exposes them under the same clearly user-owned personal contacts boundary.
