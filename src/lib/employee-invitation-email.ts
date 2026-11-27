import type { TransactionalEmail } from "./email-delivery-core.ts";

export const EMPLOYEE_INVITATION_EMAIL_SUBJECT = "Activate your LMS Platform account";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

export function createEmployeeInvitationEmail(
  recipientEmail: string,
  activationUrl: string,
): TransactionalEmail {
  const safeUrl = escapeHtml(activationUrl);
  const text = [
    "You're invited to activate your LMS Platform account.",
    "",
    "Set your password using this secure link:",
    activationUrl,
    "",
    "This link expires in 72 hours and can only be used once. If you weren't expecting this invitation, you can ignore this email.",
    "",
    "LMS Platform",
  ].join("\n");
  const html = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${EMPLOYEE_INVITATION_EMAIL_SUBJECT}</title></head>
  <body style="margin:0;background:#f3f6fb;color:#182230;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:36px 12px;">
      <tr><td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#fff;border-radius:12px;overflow:hidden;">
          <tr><td style="background:#173b63;padding:22px 32px;color:#fff;font-size:18px;font-weight:700;">LMS Platform</td></tr>
          <tr><td style="padding:32px;">
            <p style="margin:0 0 12px;color:#416b95;font-size:12px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;">Account invitation</p>
            <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25;">Activate your account</h1>
            <p style="margin:0 0 24px;font-size:16px;line-height:1.6;">You have been invited to join your organization on LMS Platform. Set a password to activate your account.</p>
            <p style="margin:0 0 24px;"><a href="${safeUrl}" style="display:inline-block;border-radius:7px;background:#1769aa;padding:13px 20px;color:#fff;font-size:15px;font-weight:700;text-decoration:none;">Set your password</a></p>
            <p style="margin:0 0 12px;color:#4b5563;font-size:14px;line-height:1.6;">This secure link expires in <strong>72 hours</strong> and can only be used once.</p>
            <p style="margin:0;color:#667085;font-size:13px;line-height:1.6;">If the button does not work, copy this link into your browser:<br><a href="${safeUrl}" style="color:#1769aa;word-break:break-all;">${safeUrl}</a></p>
            <hr style="margin:28px 0;border:0;border-top:1px solid #e5eaf0;">
            <p style="margin:0;color:#667085;font-size:12px;line-height:1.6;">If you weren't expecting this invitation, you can ignore this email.</p>
          </td></tr>
        </table>
        <p style="margin:16px 0 0;color:#667085;font-size:12px;">LMS Platform</p>
      </td></tr>
    </table>
  </body>
</html>`;
  return { to: recipientEmail, subject: EMPLOYEE_INVITATION_EMAIL_SUBJECT, html, text };
}
