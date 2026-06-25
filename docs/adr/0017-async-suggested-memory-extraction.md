# Async Suggested Memory Extraction

Phase 1A should save source records synchronously and extract suggested memories asynchronously. Capture writes the source record, records the audit event, and returns quickly; a later job or schedule can create suggested memories from active source records.

If extraction fails, the source record remains available for retry. If a source record is still `pending_resolution`, extraction should wait until the person is resolved or the user decides how to handle the record.
