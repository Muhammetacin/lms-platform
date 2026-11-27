# ADR-058 — Shared audit events

Audit events store the organization, authenticated actor's user ID, an enumerated action, a target ID, an optional related ID and a timestamp. The actor must belong to the organization. Activation uses the verified invitation identity. Events never store field values, credentials, email addresses, request bodies or invitation tokens.

Employee creation, name and profile changes, deactivation and bulk import are recorded. A bulk import records one event against the organization. Team create, update, delete, member add and member remove are recorded. Direct and team course grants and revocations record the course and the employee membership or team. Implicit child removals are covered by the parent team deletion event. No-op grants and revocations write no event. Invitation creation records that an activation record was issued. It is independent of provider acceptance or mailbox delivery. Successful activation records the credential-creation event.

The event is inserted inside the same PostgreSQL transaction as the change. Insertion failure aborts that change. The log has no application read API. Operational reads must use an authorized operator and an explicit organization filter. Target and actor IDs are retained when the associated record is removed, while deleting the organization cascades to its audit events. The operator must confirm retention before the pilot and document the scheduled cleanup. The proposed starting retention is 90 days, subject to the organization policy.

See [OWASP Logging Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html#data-to-exclude).
