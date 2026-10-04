# ADR-004: Authentication and Server-Managed Sessions

- **Status:** Accepted
- **Date:** 2026-10-04
- **Ticket:** LMS-007

## Context

The repository has a Next.js App Router application, a server-only Prisma/PostgreSQL client, and a `User` model, but no authentication dependency, identity provider, provider configuration, credentials, or sessions. LMS-007 requires password authentication, server-side identity lookup, generic failure behavior, secure cookies, logout revocation, and no usable plaintext session secret in the database. Later tickets own authorization and tenant context.

The installed Next.js authentication guide recommends considering an authentication library for production. No provider account or library is configured in this project, and the session requirements need database-backed immediate revocation while persisting only a digest of the browser's bearer token. The decision below is intentionally narrow and carries a higher maintenance burden than adopting a supported identity provider; it must be revisited before adding more authentication features.

## Decision

- Implement the current email/password and session flow server-side in the existing Next.js application. Use the App Router's asynchronous cookie API only in Route Handlers and server-only code.
- Store authentication credentials in a separate one-to-one `PasswordCredential` model. Hash passwords with Node.js `scrypt` (`N=32768`, `r=8`, `p=1`, random 16-byte salt, 64-byte key). Use a versioned encoding and constant-time comparison. Do not invent a cryptographic primitive or put password data on API responses.
- Provide only a server-only `provisionUserPassword()` helper for trusted future account-provisioning workflows; do not expose account creation or password changes to an unauthenticated public route.
- Create a 32-byte random Base64URL session token after a successful password check. Return it only as an `HttpOnly` cookie; persist only its SHA-256 digest in `Session`. The random token entropy makes a slow password KDF unnecessary for this lookup key. Set a fixed 7-day expiry; require a non-expired database row for identity lookup; delete that row on logout.
- Set cookies `HttpOnly`, `SameSite=Lax`, `Path=/`, and `Secure` in production, with explicit expiry/max-age. Use the `__Host-` prefix in production and a local-only name over development HTTP.
- Require exact same-origin `Origin` and JSON content type for login/logout. Bound the login request body. Return the same generic 401 for unknown email and wrong password, and omit internal storage/crypto errors from responses and logs.
- Make `getAuthenticatedUser()` return only safe identity fields or `null`. Authentication will not evaluate membership roles, permissions, organization access, or active tenant context.
- Leave shared rate limiting for LMS-060 because no shared limiter or trusted client-IP contract is present. Do not represent a process-local limiter as production protection.

## Alternatives considered

- **Configured managed identity provider:** would delegate credential storage and related operational security, but the repository has no approved provider, account, tenant configuration, or product decision. Selecting one would introduce an unapproved dependency/service and setup secrets.
- **Authentication library:** preferred in general by the installed Next.js guidance and a valid future replacement. No library is currently installed/configured, and this ticket has a specific digest-only database token and immediately revocable session requirement. A library should be selected when the product approves its provider/session model rather than being added without those decisions.
- **Stateless signed/encrypted cookie sessions:** rejected because logout would require additional revocation state to make a stolen old token stop authenticating immediately.
- **Raw opaque session token in the database:** rejected because database disclosure would expose reusable bearer credentials.
- **JWT in browser storage:** rejected because browser JavaScript can read and exfiltrate it, and session invalidation is less direct.
- **Lowercased email lookup:** rejected for this ticket because the existing schema permits differently cased values under its exact-value unique constraint. Lookup instead preserves the stored casing and trims only surrounding whitespace.

## Consequences and boundaries

The app owns a focused password/session implementation and its maintenance until a provider or authentication library is selected. PostgreSQL supports immediate logout and stores no usable session token. Existing `User` records do not automatically receive credentials and cannot log in until a separately trusted account-provisioning workflow stores a hash. There is no public signup or password reset. Expired session rows are rejected but not periodically deleted by this ticket.

The implementation establishes identity only. LMS-008 owns authorization; LMS-009 owns tenant context; LMS-010 owns tenant isolation. Role enforcement, organization selection, membership access, RLS, email verification, MFA, SSO, and account lifecycle flows remain out of scope. Without a shared rate limiter, the login handler must not be described as ready for public production exposure; LMS-060 should provide shared brute-force protection before that deployment.
