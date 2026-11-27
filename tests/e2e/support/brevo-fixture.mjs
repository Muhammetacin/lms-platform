import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const directory = process.env.E2E_MAIL_DIRECTORY;
const fixtureKey = "ci-brevo-fixture";

if (process.env.CI !== "true" || process.env.E2E_PRODUCTION !== "1" ||
    process.env.BREVO_API_KEY !== fixtureKey || !directory) {
  throw new Error("The Brevo fixture is restricted to synthetic production CI tests.");
}

const originalFetch = globalThis.fetch;
globalThis.fetch = async function fetchWithBrevoFixture(input, init) {
  const url = new URL(input instanceof Request ? input.url : input);
  if (url.hostname !== "api.brevo.com") return originalFetch(input, init);

  const request = new Request(input, init);
  if (url.href !== "https://api.brevo.com/v3/smtp/email" ||
      request.method !== "POST" || request.headers.get("api-key") !== fixtureKey) {
    return Response.json({ error: "unexpected_fixture_request" }, { status: 400 });
  }

  const message = await request.json();
  const recipient = Array.isArray(message.to) && message.to.length === 1 ? message.to[0] : null;
  const match = typeof recipient?.email === "string" && /^lms116-([a-f0-9]{32})@example\.test$/.exec(recipient.email);
  if (!match || recipient.contactPixelTrackingConsent !== false ||
      typeof message.htmlContent !== "string" || typeof message.textContent !== "string") {
    return Response.json({ error: "invalid_fixture_message" }, { status: 400 });
  }

  await writeFile(join(directory, `${match[1]}.json`), JSON.stringify({
    to: recipient.email,
    htmlContent: message.htmlContent,
    textContent: message.textContent,
  }), { flag: "wx", mode: 0o600 });
  return Response.json({ messageId: "ci-fixture-message" }, { status: 201 });
};
