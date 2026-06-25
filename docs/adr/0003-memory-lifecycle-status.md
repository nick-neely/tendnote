# Memory Lifecycle Status

Phase 1 models observations and memories in one `memories` table using a lifecycle status such as `suggested`, `approved`, `dismissed`, and `archived`. Suggested memories represent reviewable observations, while approved memories represent durable relationship context; promotion is a status transition with approval metadata rather than a copy into a separate table.

This avoids a premature ingestion subsystem while preserving the option to split noisy future Gmail, Calendar, or message-derived candidates into a dedicated ingestion table if that complexity becomes real.
