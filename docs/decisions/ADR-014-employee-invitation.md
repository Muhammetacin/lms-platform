# ADR-014: Employee Invitation and Account Activation

- **Status:** Accepted
- **Date:** 2026-10-05
- **Ticket:** LMS-014

## Context

LMS-012 creates employees as organization memberships and may reuse an existing global `User`. New users have no `PasswordCredential`; a reused user may already have one. LMS-007 owns password login and LMS-008/009/010 own authorization, trusted tenant context, and tenant isolation. LMS-014 needs a one-time bootstrap credential that activates only the intended active employee membership without changing an existing credential or letting the browser select a tenant.

## Decisions

1. Add `EmployeeInvitation` as the temporary bootstrap record. Each row stores user, organization, membership, token digest, expiry, and optional consumption time. Cascading foreign keys follow the existing user, organization, and membership lifecycle. Every activation check verifies that the linked membership still agrees with the invitation's user and organization.
2. Generate a 32-byte cryptographically random Base64URL token and store only its SHA-256 digest. Expire it after 72 hours and consume it exactly once.
3. Permit invitations only for active MEMBER memberships in the authenticated tenant. OWNER and ADMIN use LMS-008's existing `MANAGE_MEMBERS`; MEMBER and unauthenticated callers are denied. All admin target lookups include both trusted organization ID and membership ID.
4. Re-invitation uses one serializable PostgreSQL transaction to consume all previous unconsumed invitations for that membership and create the replacement. If creation fails, the old invitation state rolls back.
5. Activation uses a serializable transaction. It rechecks expiry, consumption, linked membership identity, active state, MEMBER role, and absence of a password credential; it then consumes the invitation and creates the credential in the same transaction. The unique `PasswordCredential.userId` constraint and serializable isolation protect concurrent activation. LMS-007's `hashPassword()` and password policy are reused unchanged in behavior.
6. An existing password credential is never changed. LMS-014 does not provide password reset, account identity mutation, or session creation. The employee uses LMS-007 login after activation.
7. No email provider or LMS-052 mail abstraction exists yet. Keep one narrow delivery interface and mark the production adapter unavailable. The admin endpoint returns a generic 503 and creates no invitation until a real provider is connected; do not return the token or simulate successful delivery. LMS-058 remains the shared audit-log dependency; do not add a separate invitation audit system.
8. Put the bearer token in the emailed URL fragment, so it is not sent in the page HTTP request or server access logs. The activation page reads and removes the fragment immediately, uses no-referrer metadata, and sends activation API calls without session cookies. Public activation derives all organization and membership identity from the invitation row.

## Consequences

The invitation table does not contain a password, password hash, or usable token. Expired, consumed, invalidly linked, or inactive-member invitations cannot activate an account. User and membership deactivation or deletion cannot be bypassed through an invitation. The email path remains unavailable until LMS-052 supplies a real provider; code paths and tests use an injected delivery boundary without adding a parallel mail framework. Invitation activity is not audited until LMS-058 is available.

## Alternatives considered

- **Store the raw token or a UUID:** rejected because a database read or predictable identifier would grant activation access.
- **Use a JWT invitation:** rejected because persisted one-time consumption and revocation are required, and there is no architectural benefit over an opaque random token.
- **Use invitations for password reset:** rejected; LMS-014 is limited to users without credentials, preserving existing authentication state.
- **Add an email sender or outbox now:** rejected because the repository has no approved LMS-052 email architecture. Do not create a fake sender or report successful delivery before that integration exists.
- **Add invitation-specific audit storage:** rejected because LMS-058 is the designated shared audit mechanism.
