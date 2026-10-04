# Authentication

LMS-007 establishes the identity of the current user. `getAuthenticatedUser()` returns a safe user identity or `null` for an unauthenticated request. It does not check roles, permissions, memberships, or organizations.

## Responsibility boundaries

- **LMS-007 — Authentication:** verify credentials and establish/invalidate a user session.
- **LMS-008 — Authorization:** decide what an authenticated user may do; see [Authorization](authorization.md).
- **LMS-009 — Tenant Context:** determine the trusted active organization.
- **LMS-010 — Tenant Isolation:** design and enforce organization data boundaries.

Authentication does not select a tenant, trust a client-provided organization ID, enforce the stored membership role, or provide tenant isolation. Do not treat an authenticated identity as authorization.

## Architecture

The current application has no identity-provider account or provider configuration. LMS-007 uses a small server-only email/password implementation on the existing Next.js App Router, Node.js crypto, and Prisma/PostgreSQL foundation. This avoids a new external service and gives logout immediate server-side revocation. The implementation owns its credential and session handling; the security model and boundaries are recorded in [ADR-004](decisions/ADR-004-authentication.md).

Authentication is exposed through same-origin JSON `POST /api/auth/login` and `POST /api/auth/logout` handlers. A server-only `provisionUserPassword()` helper hashes and inserts an initial credential for a known user ID; it is not exposed as an endpoint and does not create a user. No public registration, password reset, email verification, social login, SSO, or MFA workflow is included. A `User` without a `PasswordCredential` cannot log in; account and initial credential provisioning must be supplied by a separately scoped trusted workflow. No default account or password is created.

## Credentials

`PasswordCredential` stores one password hash per user, separate from the user profile. Hashes use Node.js `scrypt` with `N=32768`, `r=8`, `p=1`, a random 16-byte salt, a 64-byte derived key, and a 64 MiB maximum-memory setting. The encoded format identifies the version and parameters. Verification compares derived keys with `timingSafeEqual`. New passwords must contain at least 12 Unicode code points and no more than 1024 UTF-8 bytes; passwords are not trimmed or normalized. This is password hashing, not a general-purpose SHA-256 password digest.

Login trims surrounding email whitespace and preserves the remaining casing. Email lookup is an exact match, consistent with the existing `User.email` unique constraint. The app does not lowercase addresses; users must sign in with the stored casing. This behavior is deliberate until a migration defines case-insensitive uniqueness and canonicalization together.

Passwords are accepted only by the server-side login handler and password-hashing helper. They are not logged, returned, or included in errors. Missing accounts use a fixed dummy scrypt hash so unknown-account and wrong-password paths perform the same KDF and both return `401 {"error":"invalid_credentials"}`. Malformed input returns a generic `400`; unexpected storage/crypto failures return a generic `503` and log only a static message plus the operation name, without exception text or request data.

## Sessions and cookies

A successful login creates a session with a 7-day fixed expiry. The cookie carries a cryptographically random 32-byte opaque token in Base64URL form. PostgreSQL stores only the token's SHA-256 digest, never the usable token. SHA-256 is appropriate here because the input is a uniformly random 256-bit token; password hashes use scrypt. Session records include `expiresAt`, and expired sessions are rejected even if their rows remain in the database. The migration adds an expiry index for future cleanup; this ticket does not add a scheduled cleanup job.

The session cookie is `HttpOnly`, `SameSite=Lax`, scoped to `/`, and has an explicit matching expiry and max age. It is `Secure` in production. Production uses the `__Host-lms_session` prefix with no `Domain` attribute; local HTTP development uses `lms_session`. The token is not returned in JSON and is not stored in browser JavaScript storage. Login returns only `{ id, email, name }`.

`getAuthenticatedUser()` reads the server cookie, hashes its token, and looks up a non-expired session. It returns `{ id, email, name }` or `null`; it does not include membership data or authorize anything. Logout deletes the matching database session before expiring the browser cookie. A previously issued token then fails the server lookup.

## Request protection and operational limits

Both mutation routes require `Content-Type: application/json` and an exact `Origin` match to `NEXT_PUBLIC_APP_URL`. The login route accepts a bounded request body. Together with `SameSite=Lax`, the origin and content-type checks prevent cross-site browser forms and untrusted origins from using the cookie-authenticated endpoints. Future cookie-authenticated mutation endpoints must apply the same checks (or a reviewed stronger mechanism); this is not a global CSRF middleware.

Brute-force login attempts are a known threat. No shared rate-limit service or trusted client-IP interface exists in this repository. A process-local counter would reset on restart and fail across multiple instances, so LMS-007 does not claim rate limiting. Add a shared limiter with deployment-aware identity/trusted-proxy handling under LMS-060 before exposing this endpoint to a public production deployment. Scrypt raises the cost of guessing but is not a substitute for rate limiting.

## Configuration and migration

`NEXT_PUBLIC_APP_URL` must be the exact canonical application origin used by login/logout; it is already present in `.env.example`. It is public origin configuration, not a secret. `DATABASE_URL` remains server-only. This design adds no session signing secret: a random 256-bit token is persisted only as a one-way digest, and the database record provides revocation. Neither setting may be exposed under a new `NEXT_PUBLIC_` secret name.

The Prisma migration adds `PasswordCredential` and `Session`, their user foreign keys, a unique credential per user, a unique session digest, and an `expiresAt` index. Existing LMS-002 migrations are unchanged. Apply the new migration through the normal Prisma Migrate workflow; do not use `db push` as a deployment workflow.

## Deliberate exclusions

LMS-007 does not implement self-registration, credential provisioning UI, password reset, email verification, invitations, OAuth/social login, Microsoft/Google SSO, MFA, authorization/RBAC, organization access checks, active tenant context, tenant isolation, or PostgreSQL RLS. LMS-008 now owns the separate authorization layer; LMS-009 owns tenant context, and LMS-010 owns tenant isolation.
