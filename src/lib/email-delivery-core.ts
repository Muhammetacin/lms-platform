export type TransactionalEmail = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export interface TransactionalEmailProvider {
  send(message: TransactionalEmail): Promise<void>;
}

export type EmailDeliveryFailureCode =
  | "configuration"
  | "provider_rejected"
  | "network"
  | "timeout";

/** A deliberately sanitized provider error; never attach request/response data. */
export class EmailDeliveryError extends Error {
  readonly code: EmailDeliveryFailureCode;

  constructor(code: EmailDeliveryFailureCode) {
    super("Transactional email delivery failed.");
    this.name = "EmailDeliveryError";
    this.code = code;
  }
}
