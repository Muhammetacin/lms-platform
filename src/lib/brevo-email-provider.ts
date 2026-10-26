import {
  EmailDeliveryError,
  type TransactionalEmail,
  type TransactionalEmailProvider,
} from "./email-delivery-core.ts";

export type BrevoEmailConfiguration = {
  apiKey?: string;
  senderEmail?: string;
  senderName?: string;
};

export type BrevoEmailProviderOptions = {
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
};

function isValidSenderEmail(value: string | undefined): boolean {
  return typeof value === "string" && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isBrevoEmailConfigured(configuration: BrevoEmailConfiguration): boolean {
  return typeof configuration.apiKey === "string" && configuration.apiKey.trim().length > 0
    && isValidSenderEmail(configuration.senderEmail)
    && typeof configuration.senderName === "string"
    && configuration.senderName.trim().length > 0
    && !/[\u0000-\u001f\u007f]/.test(configuration.senderName);
}

export function createBrevoEmailProvider(
  configuration: BrevoEmailConfiguration,
  options: BrevoEmailProviderOptions = {},
): TransactionalEmailProvider {
  return {
    async send(message: TransactionalEmail): Promise<void> {
      if (!isBrevoEmailConfigured(configuration)) throw new EmailDeliveryError("configuration");

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
      try {
        const response = await (options.fetchImplementation ?? fetch)("https://api.brevo.com/v3/smtp/email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "api-key": configuration.apiKey!.trim(),
            "content-type": "application/json",
          },
          body: JSON.stringify({
            sender: { email: configuration.senderEmail!.trim(), name: configuration.senderName!.trim() },
            to: [{ email: message.to }],
            subject: message.subject,
            htmlContent: message.html,
            textContent: message.text,
          }),
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new EmailDeliveryError("provider_rejected");
      } catch (error) {
        if (error instanceof EmailDeliveryError) throw error;
        throw new EmailDeliveryError(controller.signal.aborted ? "timeout" : "network");
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
