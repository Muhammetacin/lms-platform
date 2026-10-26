# Transactional Email Setup

LMS-052 sends employee activation invitations through a replaceable server-side email provider. Brevo is the initial provider. The application submits one email per invitation and includes both HTML and plain-text alternatives. No provider SDK is required; the adapter uses Brevo's HTTPS API.

## Operational setup

Complete these steps with the person responsible for the LMS and its sender domain:

1. Create or select the organization's Brevo account and enable transactional email.
2. Review and approve Brevo's current DPA, subprocessors, retention settings, and privacy terms for the intended use. Brevo documents EU-hosted databases, but the organization's own transfer and retention assessment remains necessary.
3. Verify the sending domain in Brevo. Publish the SPF and DKIM DNS records Brevo provides, and configure DMARC for the domain. Allow DNS changes to propagate and confirm the sender is verified in the Brevo console.
4. Create a server-to-server API key with only the access needed for transactional email. Store it in the deployment's secret manager or in ignored `.env.local` during local development. Do not put it in source control, client-side variables, issue comments, or logs.
5. Set `EMAIL_FROM_ADDRESS` to an address on the verified domain and `EMAIL_FROM_NAME` to the approved display name. The default display name is `LMS Platform`.
6. Set `NEXT_PUBLIC_APP_URL` to the canonical application origin. Invitation links are built from this origin and put the bearer token in the URL fragment.

## Configuration

| Variable | Required | Description |
| --- | --- | --- |
| `BREVO_API_KEY` | Yes, to send | Private Brevo API key. Server-only; never prefix with `NEXT_PUBLIC_`. |
| `EMAIL_FROM_ADDRESS` | Yes, to send | Verified sender email address on the configured sending domain. |
| `EMAIL_FROM_NAME` | No | Sender display name; defaults to `LMS Platform`. |
| `NEXT_PUBLIC_APP_URL` | Yes, to invite | Existing application origin used to build `/auth/activate` links. |

If provider configuration is absent or invalid, the invitation endpoint returns a safe 503 without creating a new invitation. When Brevo accepts the API request, the endpoint returns its existing generic success response. Acceptance means the provider queued the request; it does not confirm inbox delivery. Bounce and delivery-event webhooks are not part of this ticket.

## Local development and testing

1. Copy `.env.example` to `.env.local` and configure the app/database values needed for local development.
2. For a dry run, leave `BREVO_API_KEY` blank. Automated tests inject a mock provider/fetch implementation; they never call Brevo or send email.
3. To verify an end-to-end message manually, first use an approved Brevo account, verified sender domain, and test recipient. Add the API key only to ignored `.env.local`, set the sender values, then restart `pnpm dev` so the server reads the configuration.
4. Sign in as an OWNER or ADMIN, open an active MEMBER employee profile, and choose **Send activation invitation**. The UI reports when the provider accepts the request; check the recipient mailbox and Brevo transaction log separately to confirm actual delivery.
5. Remove local credentials when finished. Never use production recipients for automated tests.

Run provider and invitation unit coverage with:

```powershell
pnpm test:email-delivery
pnpm test:employee-invitation
```

PostgreSQL invitation tests require the CI-provided, isolated `TEST_DATABASE_URL` for `lms_platform_test`. Browser E2E uses only the guarded `E2E_DATABASE_URL` for `lms_platform_e2e`. Never point either test command at a development or production database.

## Delivery behavior and privacy

- The provider is called only by the server-side invitation adapter. The API key is sent in Brevo's `api-key` header and is never serialized into client code or error logs.
- The email includes the target email address, the activation link, and a statement that the link expires after 72 hours and is single use. It contains no organization-specific profile data.
- The invitation token remains 256-bit random, hash-only in PostgreSQL, fragment-only in the activation URL, valid for 72 hours, and consumed atomically with credential creation. Existing tenant checks and `MANAGE_MEMBERS` authorization remain authoritative.
- Provider errors are mapped to safe categories. Logs contain only the operation and a category (`configuration`, `provider_rejected`, `network`, `timeout`, or `unknown`); they omit recipient addresses, provider response bodies, activation URLs/tokens, and credentials.
- A network timeout can leave the provider's acceptance uncertain. The invitation is invalidated on failed sends, so an email that the provider accepted just before a timeout may contain an expired invitation. Do not blindly retry provider requests inside the adapter; an administrator can submit a new invitation, which invalidates previous invitation tokens. Provider acceptance itself is not proof of delivery.
- Provider-side delivery/open/bounce observability and a durable email outbox are future operational work. LMS-058 remains the shared audit-log dependency.
