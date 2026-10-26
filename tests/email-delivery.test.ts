import assert from "node:assert/strict";
import test from "node:test";
import {
  createBrevoEmailProvider,
  isBrevoEmailConfigured,
} from "../src/lib/brevo-email-provider.ts";
import { createEmployeeInvitationEmail } from "../src/lib/employee-invitation-email.ts";
import { EmailDeliveryError } from "../src/lib/email-delivery-core.ts";

const configuration = {
  apiKey: "test-api-key",
  senderEmail: "noreply@example.test",
  senderName: "LMS Platform",
};

test("Brevo configuration requires a private API key and valid verified-sender fields", () => {
  assert.equal(isBrevoEmailConfigured(configuration), true);
  assert.equal(isBrevoEmailConfigured({ ...configuration, apiKey: " " }), false);
  assert.equal(isBrevoEmailConfigured({ ...configuration, senderEmail: "not-an-email" }), false);
  assert.equal(isBrevoEmailConfigured({ ...configuration, senderName: "   " }), false);
});

test("invitation template includes HTML and plain text without inserting recipient markup", () => {
  const token = "A".repeat(43);
  const email = createEmployeeInvitationEmail(
    "<employee@example.test>",
    `https://lms.example.test/auth/activate#token=${token}`,
  );
  assert.equal(email.to, "<employee@example.test>");
  assert.match(email.subject, /Activate your LMS Platform account/);
  assert.match(email.text, new RegExp(token));
  assert.match(email.text, /expires in 72 hours/);
  assert.match(email.html, /Set your password/);
  assert.doesNotMatch(email.html, /<employee@example\.test>/);
  assert.doesNotMatch(email.html, /&lt;employee@example\.test&gt;/);
});

test("Brevo adapter sends both email alternatives with server-only credentials", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const provider = createBrevoEmailProvider(configuration, {
    fetchImplementation: async (input, init) => {
      requestUrl = String(input);
      requestInit = init;
      return Response.json({ messageId: "mock-message-id" }, { status: 201 });
    },
  });
  const message = createEmployeeInvitationEmail("employee@example.test", "https://lms.example.test/#token=secret-token");
  await provider.send(message);

  assert.equal(requestUrl, "https://api.brevo.com/v3/smtp/email");
  assert.equal(requestInit?.method, "POST");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("api-key"), configuration.apiKey);
  assert.equal(headers.get("cache-control"), null);
  assert.equal(requestInit?.cache, "no-store");
  const payload = JSON.parse(String(requestInit?.body)) as Record<string, unknown>;
  assert.deepEqual(payload.sender, { email: configuration.senderEmail, name: configuration.senderName });
  assert.deepEqual(payload.to, [{ email: "employee@example.test" }]);
  assert.equal(payload.subject, message.subject);
  assert.equal(payload.htmlContent, message.html);
  assert.equal(payload.textContent, message.text);
});

test("Brevo rejection is sanitized and never includes provider body or request data", async () => {
  const secret = "xkeysib-secret-value";
  const token = "private-activation-token";
  const provider = createBrevoEmailProvider({ ...configuration, apiKey: secret }, {
    fetchImplementation: async () => Response.json({ message: `${secret} ${token}` }, { status: 401 }),
  });
  await assert.rejects(
    provider.send(createEmployeeInvitationEmail("employee@example.test", `https://example.test/#${token}`)),
    (error: unknown) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, "provider_rejected");
      assert.doesNotMatch(error.message, new RegExp(`${secret}|${token}`));
      return true;
    },
  );
});

test("missing Brevo configuration fails before making a network request", async () => {
  let requestCount = 0;
  const provider = createBrevoEmailProvider({ senderName: "LMS Platform" }, {
    fetchImplementation: async () => {
      requestCount += 1;
      return Response.json({ messageId: "unexpected" }, { status: 201 });
    },
  });
  await assert.rejects(
    provider.send(createEmployeeInvitationEmail("employee@example.test", "https://example.test/#token")),
    (error: unknown) => error instanceof EmailDeliveryError && error.code === "configuration",
  );
  assert.equal(requestCount, 0);
});

test("Brevo request timeout is translated without exposing the underlying error", async () => {
  const provider = createBrevoEmailProvider(configuration, {
    timeoutMs: 5,
    fetchImplementation: async (_input, init) => await new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("token and API key")), { once: true });
    }),
  });
  await assert.rejects(
    provider.send(createEmployeeInvitationEmail("employee@example.test", "https://example.test/#token")),
    (error: unknown) => {
      assert.ok(error instanceof EmailDeliveryError);
      assert.equal(error.code, "timeout");
      assert.doesNotMatch(error.message, /token|API key/);
      return true;
    },
  );
});
