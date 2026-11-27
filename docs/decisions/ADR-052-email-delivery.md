# ADR-052: Transactional Email Delivery

- **Status:** Accepted for MVP implementation; provider account, sender verification, and privacy review remain operational prerequisites
- **Date:** 2026-10-26
- **Ticket:** LMS-052

## Context

LMS-014 already owns eligibility, authorization, tenant isolation, token generation, expiry, storage, and atomic account activation. Its `EmployeeInvitationDelivery` boundary intentionally reported unavailable until an approved delivery service existed. LMS-052 needs to deliver the existing activation link without duplicating invitation or authentication logic.

## Decision

1. Use Brevo as the MVP transactional provider following CEO approval. The operational owner must separately approve the account, sender identity/domain, current DPA/privacy terms, and credentials before live sends.
2. Keep a provider-neutral `TransactionalEmailProvider` interface and a Brevo implementation behind it. Use the Brevo HTTPS API with native `fetch` to avoid introducing an SDK dependency for the single-email use case.
3. Render the invitation as branded inline HTML plus plain text in application code. The template contains only the activation link, the recipient address, expiry/single-use guidance, and LMS Platform branding.
4. Read `BREVO_API_KEY`, `EMAIL_FROM_ADDRESS`, and optional `EMAIL_FROM_NAME` only in server code. Use the existing `NEXT_PUBLIC_APP_URL` for activation links.
5. A provider 2xx response means accepted for processing, not delivered to the recipient. Do not retry automatically. A failure returns a safe 503; the existing LMS-014 logic invalidates the newly created invitation after a failed send.
6. Log only the operation and a bounded failure category. Do not log provider response bodies, recipient addresses, raw tokens, activation URLs, or API credentials.
7. Keep LMS-058 as the audit log mechanism. Provider webhooks, bounce handling, and a durable outbox are outside LMS-052.

## Consequences

The invitation security boundary and schema remain unchanged. Missing configuration disables invitations without creating invitation records. An uncertain provider timeout may mean the provider accepted the request before the connection failed; the invitation is invalidated on a reported failure, so a recipient could receive an unusable link. A later administrator retry creates a replacement and invalidates previous tokens. Automated tests inject a mock provider and do not send email.

## Privacy and operations

Brevo's published data-location documentation states that databases are hosted in the EU. This does not replace the organization's assessment of Brevo's DPA, subprocessors, message retention, or international transfers. See [Transactional Email Setup](../email-delivery.md) for account setup, DNS, secrets, and test procedures.
