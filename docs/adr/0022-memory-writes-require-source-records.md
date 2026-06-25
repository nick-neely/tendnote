# Memory Writes Require Source Records

Phase 1A memory writes should require source-record provenance. Normal app and agent writes must create or reference a `source_record_id` before creating a memory, whether the memory starts as `suggested` or `approved`.

Development seed data, imports, or repair scripts may create controlled fallback source records such as `source_type = seed`, but the shared mutation layer should not allow provenance-free memories in normal product flows.
