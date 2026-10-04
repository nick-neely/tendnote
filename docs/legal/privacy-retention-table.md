<!-- Generated from packages/domain/src/retention.ts. Do not edit by hand. -->

# Retention

| Data | Retained |
| --- | --- |
| Active account content | While the account exists |
| Lapsed account content | 90 days from entering Lapsed, then deleted |
| Terminated account content | 90 days from termination, then deleted |
| Deleted account | The account closes at once and its content leaves the live database within minutes; residual backup copies expire within the Backup Window of 7 days, and a restore never brings it back |
| Deletion Records | 30 days; the restore fences for email and export, 14 days. Neither holds content |
| Shared household records after the household ends | 30 days after the household ends, then deleted; what each member wrote privately stays theirs |
| Billing records | Held by Stripe and the operator for the period tax law requires; never contain content |
| Usage records | 13 months; content-free |
| Support email | 2 years |
| Audit log | 2 years |
| Incident records | 3 years from closure |
| Optional telemetry | Account-linked funnel events erased on deletion or after 90 days; anonymous daily totals 13 months |
