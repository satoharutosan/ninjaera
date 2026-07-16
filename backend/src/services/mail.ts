import crypto from "crypto";
import {
  getMailTransport,
  resetMailTransportCache,
  resendApiKey,
  smtpProviderHint,
  useResendHttp,
  type MailMessage,
  type MailSendResult,
} from "./mailTransport.js";

const DEFAULT_FROM_NAME = "Ninja Era";
const DEFAULT_FROM_ADDRESS = "softfuture28@gmail.com";

/** Cloudinary-hosted brand logo for all authentication emails (not Base64-embedded). */
export const DEFAULT_EMAIL_BRAND_LOGO_URL =
  "https://res.cloudinary.com/nitb8mqu/image/upload/v1784207614/logo_tgwmkv.png";

const VERIFY_TTL_MS = Number(process.env.EMAIL_VERIFY_TTL_MS) || 15 * 60 * 1000;
export const EMAIL_VERIFY_TTL_MS = VERIFY_TTL_MS;
export const EMAIL_RESEND_COOLDOWN_MS = Number(process.env.EMAIL_RESEND_COOLDOWN_MS) || 60_000;

const PASSWORD_RESET_TTL = Number(process.env.PASSWORD_RESET_TTL_MS) || 20 * 60 * 1000;
export const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL;
export const PASSWORD_RESET_RESEND_COOLDOWN_MS =
  Number(process.env.PASSWORD_RESET_RESEND_COOLDOWN_MS) || 60_000;

const USER_FACING_SEND_ERROR =
  "We could not send the verification email. Please try again shortly.";
const USER_FACING_RESET_SEND_ERROR =
  "We could not send the password reset email. Please try again shortly.";

let lastVerifyOk: boolean | null = null;
let lastVerifyError: string | null = null;

function env(name: string): string {
  return (process.env[name] || "").trim();
}

export function mailFromName(): string {
  return env("MAIL_FROM_NAME") || DEFAULT_FROM_NAME;
}

export function mailFromAddress(): string {
  return env("MAIL_FROM_ADDRESS") || DEFAULT_FROM_ADDRESS;
}

/** RFC 5322 From header: `Ninja Era <softfuture28@gmail.com>` */
export function mailFromHeader(): string {
  return `${mailFromName()} <${mailFromAddress()}>`;
}

/** @deprecated Prefer mailFromName() / mailFromAddress() / mailFromHeader() */
export const MAIL_FROM_NAME = DEFAULT_FROM_NAME;
export const MAIL_FROM_ADDRESS = DEFAULT_FROM_ADDRESS;
export const MAIL_FROM = `${DEFAULT_FROM_NAME} <${DEFAULT_FROM_ADDRESS}>`;

export function mailConfigured(): boolean {
  // Resend HTTP API: RESEND_API_KEY (or SMTP_PASS when SMTP_PROVIDER=resend).
  // SMTP transports (Gmail / SendGrid / Mailgun / SES / Brevo): SMTP_USER + SMTP_PASS.
  if (resendApiKey() && useResendHttp()) return true;
  return Boolean(env("SMTP_USER") && env("SMTP_PASS"));
}

function mailRuntimeSummary(): {
  transport: string;
  provider: string;
  host: string;
  port: number;
  ipv4: boolean;
  from: string;
} {
  const t = getMailTransport();
  return {
    transport: t.kind,
    provider: t.provider,
    host: t.host,
    port: t.port,
    ipv4: t.ipv4,
    from: mailFromHeader(),
  };
}

export function resetMailTransport() {
  resetMailTransportCache();
  lastVerifyOk = null;
  lastVerifyError = null;
}

function logMailFailureBanner(reason: string, detail?: unknown) {
  const summary = mailRuntimeSummary();
  console.error("[mail] ==========================================================");
  console.error(`[mail] MAIL UNAVAILABLE — ${reason}`);
  console.error(
    `[mail] transport=${summary.transport} provider=${summary.provider} ` +
      `host=${summary.host}:${summary.port} ipv4=${summary.ipv4}`,
  );
  console.error(`[mail] from=${summary.from}`);
  if (detail) console.error("[mail] detail:", sanitizeMailError(detail));
  console.error("[mail] Email/password signup & password reset will return 503 until fixed.");
  console.error(`[mail] Hint: ${smtpProviderHint()}`);
  console.error("[mail] Railway-friendly quick fix (Resend HTTP API — no SMTP ports needed):");
  console.error("[mail]   SMTP_PROVIDER=resend");
  console.error("[mail]   RESEND_API_KEY=<Resend API key>");
  console.error("[mail]   MAIL_FROM_ADDRESS=<verified@yourdomain>");
  console.error("[mail] ==========================================================");
}

/** Single source of truth for brand logos in email templates. */
export function emailBrandLogoUrl(): string {
  return env("EMAIL_BRAND_LOGO_URL") || DEFAULT_EMAIL_BRAND_LOGO_URL;
}

export function generateVerificationCode(): string {
  const n = crypto.randomInt(0, 1_000_000);
  return String(n).padStart(6, "0");
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function hashSecret(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function frontendBaseUrl(): string {
  return (env("FRONTEND_URL") || env("CORS_ORIGIN") || "http://localhost:5173").replace(/\/$/, "");
}

export function buildVerifyLink(token: string): string {
  return `${frontendBaseUrl()}/#/verify-email?token=${encodeURIComponent(token)}`;
}

export function buildPasswordResetLink(token: string): string {
  return `${frontendBaseUrl()}/#/reset-password?token=${encodeURIComponent(token)}`;
}

export function buildVerificationEmailHtml(opts: {
  username: string;
  code: string;
  verifyUrl: string;
  expiresMinutes: number;
}): string {
  const logo = emailBrandLogoUrl();
  const brand = mailFromName();
  const { username, code, verifyUrl, expiresMinutes } = opts;
  // Display font for the header title only. Many clients (Gmail, Outlook desktop)
  // ignore web fonts and will use the Georgia / Times fallbacks automatically.
  const brandHeadingFont =
    "'Trade Winds', Georgia, 'Times New Roman', Times, serif";
  const digits = code
    .split("")
    .map(
      (d) =>
        `<td style="width:36px;height:44px;border:1px solid #CAC4D0;border-radius:8px;background:#F7F2FA;text-align:center;font-size:22px;font-weight:600;font-family:Roboto,Arial,sans-serif;color:#1C1B1F;letter-spacing:0;">${d}</td>`,
    )
    .join('<td style="width:6px;"></td>');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Verify your email · ${escapeHtml(brand)}</title>
  <!-- Trade Winds: used by clients that support web fonts (e.g. Apple Mail). Others ignore this and use fallbacks. -->
  <link href="https://fonts.googleapis.com/css2?family=Trade+Winds&display=swap" rel="stylesheet" />
  <style type="text/css">
    .ne-brand-title { font-family: ${brandHeadingFont} !important; }
  </style>
  <!--[if mso]>
  <style type="text/css">
    .ne-brand-title { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#F3EDF7;font-family:Roboto,Helvetica,Arial,sans-serif;color:#1C1B1F;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3EDF7;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFBFE;border-radius:24px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#6750A4 0%,#4F378B 100%);padding:28px 32px;text-align:center;">
              <img src="${escapeHtml(logo)}" alt="Ninja Era Logo" width="72" height="72" style="display:inline-block;width:72px;max-width:72px;height:auto;border:0;outline:none;text-decoration:none;border-radius:16px;background:#FFFBFE;padding:6px;-ms-interpolation-mode:bicubic;" />
              <h1 class="ne-brand-title" style="margin:16px 0 0;font-size:26px;font-weight:400;color:#FFFFFF;letter-spacing:0.5px;font-family:${brandHeadingFont};line-height:1.25;">${escapeHtml(brand)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:500;color:#1C1B1F;">Verify your email</h2>
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#49454F;">
                Hi ${escapeHtml(username)},
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#49454F;">
                Thanks for joining ${escapeHtml(brand)}. Enter this verification code to confirm your email address and activate your account:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 24px;">
                <tr>${digits}</tr>
              </table>
              <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#49454F;text-align:center;">
                Or tap the button below to verify instantly:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:999px;background:#6750A4;">
                    <a href="${escapeHtml(verifyUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:999px;">
                      Verify email address
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#79747E;word-break:break-all;">
                If the button does not work, copy and paste this link into your browser:<br />
                <a href="${escapeHtml(verifyUrl)}" style="color:#6750A4;">${escapeHtml(verifyUrl)}</a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#79747E;">
                This code and link expire in <strong>${expiresMinutes} minutes</strong>.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#79747E;">
                If you did not create a ${escapeHtml(brand)} account, you can safely ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px;border-top:1px solid #E7E0EC;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#79747E;text-align:center;">
                Need help? Contact us at
                <a href="mailto:support@ninjaera.com" style="color:#6750A4;text-decoration:none;">support@ninjaera.com</a><br />
                © ${new Date().getFullYear()} ${escapeHtml(brand)}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeMailError(err: unknown): Record<string, unknown> {
  if (!err || typeof err !== "object") return { message: String(err) };
  const e = err as {
    message?: string;
    code?: string;
    responseCode?: number;
    response?: string;
    command?: string;
  };
  let message = e.message || "";
  // Strip anything that looks like a password/app-password leak in provider text
  message = message.replace(/pass(word|wd)?[=:].*/gi, "[redacted]");
  return {
    message,
    code: e.code,
    responseCode: e.responseCode,
    response: typeof e.response === "string" ? e.response.slice(0, 300).replace(/pass(word|wd)?[=:].*/gi, "[redacted]") : undefined,
    command: e.command,
  };
}

function isAuthFailure(err: unknown): boolean {
  const info = sanitizeMailError(err);
  const msg = String(info.message || "").toLowerCase();
  return (
    info.responseCode === 535 ||
    info.responseCode === 534 ||
    info.code === "EAUTH" ||
    msg.includes("invalid login") ||
    msg.includes("username and password not accepted") ||
    msg.includes("authentication failed")
  );
}

function isTransientFailure(err: unknown): boolean {
  const info = sanitizeMailError(err);
  const msg = String(info.message || "").toLowerCase();
  return (
    info.code === "ECONNECTION" ||
    info.code === "ETIMEDOUT" ||
    info.code === "ESOCKET" ||
    info.code === "ECONNRESET" ||
    info.code === "ENETUNREACH" ||
    info.code === "EHOSTUNREACH" ||
    msg.includes("enetunreach") ||
    msg.includes("connection timeout") ||
    info.responseCode === 421 ||
    info.responseCode === 450 ||
    info.responseCode === 451
  );
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

async function sendWithRetry(
  mail: MailMessage,
  attempts = 3,
): Promise<MailSendResult> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await getMailTransport().send(mail);
    } catch (err) {
      lastErr = err;
      const info = sanitizeMailError(err);
      if (isAuthFailure(err)) {
        console.error("[mail] SMTP authentication failure", info);
        break; // do not retry bad credentials
      }
      const transient = isTransientFailure(err);
      console.error(`[mail] send attempt ${i + 1}/${attempts} failed`, info);
      if (!transient || i === attempts - 1) break;
      await sleep(400 * (i + 1));
    }
  }
  throw lastErr;
}

export async function verifyMailOnStartup(): Promise<void> {
  if (!mailConfigured()) {
    lastVerifyOk = false;
    lastVerifyError = "SMTP_USER / SMTP_PASS not set";
    logMailFailureBanner("not configured");
    return;
  }

  const summary = mailRuntimeSummary();
  try {
    await getMailTransport().verify();
    lastVerifyOk = true;
    lastVerifyError = null;
    console.info(
      `[mail] ready transport=${summary.transport} provider=${summary.provider} ` +
        `host=${summary.host}:${summary.port} ipv4=${summary.ipv4} from=${summary.from}`,
    );
    if (summary.transport === "smtp" && (summary.provider === "gmail" || summary.host.includes("gmail"))) {
      console.warn(
        "[mail] Using Gmail SMTP. If Railway logs show ETIMEDOUT/ENETUNREACH, switch to SMTP_PROVIDER=resend + RESEND_API_KEY (HTTP API).",
      );
    }
  } catch (err) {
    lastVerifyOk = false;
    const info = sanitizeMailError(err);
    lastVerifyError = String(info.message || info.code || "verify failed");
    if (isAuthFailure(err)) {
      logMailFailureBanner("authentication failed (check App Password / API key)", err);
    } else {
      logMailFailureBanner("connection/verify failed (timeout or network blocked)", err);
    }
  }
}

export function mailStatus(): {
  configured: boolean;
  verified: boolean | null;
  from: string;
  fromName: string;
  fromAddress: string;
  transport: string;
  provider: string;
  host: string;
  port: number;
  ipv4: boolean;
  error: string | null;
} {
  const summary = mailRuntimeSummary();
  return {
    configured: mailConfigured(),
    verified: lastVerifyOk,
    from: mailFromHeader(),
    fromName: mailFromName(),
    fromAddress: mailFromAddress(),
    transport: summary.transport,
    provider: summary.provider,
    host: summary.host,
    port: summary.port,
    ipv4: summary.ipv4,
    error: lastVerifyError,
  };
}

export async function sendVerificationEmail(opts: {
  to: string;
  username: string;
  code: string;
  token: string;
}): Promise<void> {
  console.info(`[mail] verification email requested to=${opts.to} from=${mailFromHeader()}`);

  if (!mailConfigured()) {
    console.error("[mail] SMTP failure: not configured");
    throw Object.assign(new Error(USER_FACING_SEND_ERROR), {
      status: 503,
      code: "SMTP_NOT_CONFIGURED",
    });
  }

  // Local-only bypass: never log codes/tokens
  if (env("EMAIL_DEV_CONSOLE") === "true" && process.env.NODE_ENV !== "production") {
    console.info(
      `[mail:dev-console] Simulated send to=${opts.to} from=${mailFromHeader()} (codes/tokens are not logged)`,
    );
    return;
  }

  const verifyUrl = buildVerifyLink(opts.token);
  const expiresMinutes = Math.max(1, Math.round(EMAIL_VERIFY_TTL_MS / 60_000));
  const brand = mailFromName();
  const html = buildVerificationEmailHtml({
    username: opts.username,
    code: opts.code,
    verifyUrl,
    expiresMinutes,
  });
  const text = [
    `Hi ${opts.username},`,
    "",
    `Thanks for joining ${brand}. Use this verification code to activate your account:`,
    "",
    opts.code,
    "",
    `Or open this link: ${verifyUrl}`,
    "",
    `This code expires in ${expiresMinutes} minutes.`,
    "",
    `If you did not create a ${brand} account, ignore this email.`,
  ].join("\n");

  try {
    const info = await sendWithRetry({
      from: mailFromHeader(),
      to: opts.to,
      subject: `Verify your ${brand} email`,
      text,
      html,
      headers: {
        "X-Entity-Ref-ID": crypto.randomBytes(8).toString("hex"),
      },
    });
    console.info(
      `[mail] verification email sent successfully to=${opts.to} ` +
        `messageId=${info.messageId || "n/a"} accepted=${JSON.stringify(info.accepted || [])}`,
    );
  } catch (err) {
    if (isAuthFailure(err)) {
      console.error("[mail] SMTP authentication failure while sending verification", {
        to: opts.to,
        ...sanitizeMailError(err),
      });
    } else {
      console.error("[mail] SMTP failure while sending verification", {
        to: opts.to,
        ...sanitizeMailError(err),
      });
    }
    throw Object.assign(new Error(USER_FACING_SEND_ERROR), {
      status: 503,
      code: "SMTP_SEND_FAILED",
      cause: err,
    });
  }
}

function emailShell(opts: {
  title: string;
  heading: string;
  bodyHtml: string;
}): string {
  const logo = emailBrandLogoUrl();
  const brand = mailFromName();
  const brandHeadingFont =
    "'Trade Winds', Georgia, 'Times New Roman', Times, serif";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(opts.title)} · ${escapeHtml(brand)}</title>
  <link href="https://fonts.googleapis.com/css2?family=Trade+Winds&display=swap" rel="stylesheet" />
  <style type="text/css">
    .ne-brand-title { font-family: ${brandHeadingFont} !important; }
  </style>
  <!--[if mso]>
  <style type="text/css">
    .ne-brand-title { font-family: Georgia, 'Times New Roman', serif !important; }
  </style>
  <![endif]-->
</head>
<body style="margin:0;padding:0;background:#F3EDF7;font-family:Roboto,Helvetica,Arial,sans-serif;color:#1C1B1F;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F3EDF7;padding:32px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFBFE;border-radius:24px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,.08);">
          <tr>
            <td style="background:linear-gradient(135deg,#6750A4 0%,#4F378B 100%);padding:28px 32px;text-align:center;">
              <img src="${escapeHtml(logo)}" alt="Ninja Era Logo" width="72" height="72" style="display:inline-block;width:72px;max-width:72px;height:auto;border:0;outline:none;text-decoration:none;border-radius:16px;background:#FFFBFE;padding:6px;-ms-interpolation-mode:bicubic;" />
              <h1 class="ne-brand-title" style="margin:16px 0 0;font-size:26px;font-weight:400;color:#FFFFFF;letter-spacing:0.5px;font-family:${brandHeadingFont};line-height:1.25;">${escapeHtml(brand)}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px 8px;">
              <h2 style="margin:0 0 12px;font-size:20px;font-weight:500;color:#1C1B1F;">${escapeHtml(opts.heading)}</h2>
              ${opts.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 28px;border-top:1px solid #E7E0EC;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#79747E;text-align:center;">
                Need help? Contact us at
                <a href="mailto:support@ninjaera.com" style="color:#6750A4;text-decoration:none;">support@ninjaera.com</a><br />
                © ${new Date().getFullYear()} ${escapeHtml(brand)}. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export function buildPasswordResetEmailHtml(opts: {
  username: string;
  resetUrl: string;
  expiresMinutes: number;
}): string {
  const brand = mailFromName();
  const { username, resetUrl, expiresMinutes } = opts;
  const bodyHtml = `
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#49454F;">
                Hi ${escapeHtml(username)},
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#49454F;">
                We received a request to reset the password for your ${escapeHtml(brand)} account. Click the button below to choose a new password:
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:999px;background:#6750A4;">
                    <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:999px;">
                      Reset password
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:13px;line-height:1.5;color:#79747E;word-break:break-all;">
                If the button does not work, copy and paste this link into your browser:<br />
                <a href="${escapeHtml(resetUrl)}" style="color:#6750A4;">${escapeHtml(resetUrl)}</a>
              </p>
              <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#79747E;">
                This link expires in <strong>${expiresMinutes} minutes</strong> and can only be used once.
              </p>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#B3261E;">
                If you did not request a password reset, ignore this email. Your password will stay the same and your account remains secure.
              </p>`;
  return emailShell({
    title: "Reset your password",
    heading: "Reset your password",
    bodyHtml,
  });
}

export async function sendPasswordResetEmail(opts: {
  to: string;
  username: string;
  token: string;
}): Promise<void> {
  console.info(`[mail] password reset email requested to=${opts.to} from=${mailFromHeader()}`);

  if (!mailConfigured()) {
    console.error("[mail] SMTP failure: not configured");
    throw Object.assign(new Error(USER_FACING_RESET_SEND_ERROR), {
      status: 503,
      code: "SMTP_NOT_CONFIGURED",
    });
  }

  if (env("EMAIL_DEV_CONSOLE") === "true" && process.env.NODE_ENV !== "production") {
    console.info(
      `[mail:dev-console] Simulated password-reset send to=${opts.to} from=${mailFromHeader()} (tokens are not logged)`,
    );
    return;
  }

  const resetUrl = buildPasswordResetLink(opts.token);
  const expiresMinutes = Math.max(1, Math.round(PASSWORD_RESET_TTL_MS / 60_000));
  const brand = mailFromName();
  const html = buildPasswordResetEmailHtml({
    username: opts.username,
    resetUrl,
    expiresMinutes,
  });
  const text = [
    `Hi ${opts.username},`,
    "",
    `We received a request to reset your ${brand} password.`,
    "",
    `Open this link to choose a new password:`,
    resetUrl,
    "",
    `This link expires in ${expiresMinutes} minutes and can only be used once.`,
    "",
    `If you did not request a password reset, ignore this email.`,
  ].join("\n");

  try {
    const info = await sendWithRetry({
      from: mailFromHeader(),
      to: opts.to,
      subject: `Reset your ${brand} password`,
      text,
      html,
      headers: {
        "X-Entity-Ref-ID": crypto.randomBytes(8).toString("hex"),
      },
    });
    console.info(
      `[mail] password reset email sent successfully to=${opts.to} ` +
        `messageId=${info.messageId || "n/a"} accepted=${JSON.stringify(info.accepted || [])}`,
    );
  } catch (err) {
    console.error("[mail] SMTP failure while sending password reset", {
      to: opts.to,
      ...sanitizeMailError(err),
    });
    throw Object.assign(new Error(USER_FACING_RESET_SEND_ERROR), {
      status: 503,
      code: "SMTP_SEND_FAILED",
      cause: err,
    });
  }
}

export async function sendOAuthAccountReminderEmail(opts: {
  to: string;
  username: string;
}): Promise<void> {
  if (!mailConfigured()) return;
  if (env("EMAIL_DEV_CONSOLE") === "true" && process.env.NODE_ENV !== "production") {
    console.info(`[mail:dev-console] Simulated OAuth reminder to=${opts.to}`);
    return;
  }

  const brand = mailFromName();
  const loginUrl = `${frontendBaseUrl()}/#/login`;
  const bodyHtml = `
              <p style="margin:0 0 16px;font-size:15px;line-height:1.55;color:#49454F;">
                Hi ${escapeHtml(opts.username)},
              </p>
              <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#49454F;">
                Someone requested a password reset for this email on ${escapeHtml(brand)}. Your account signs in with Google, GitHub, or Discord — there is no password to reset.
              </p>
              <table role="presentation" cellspacing="0" cellpadding="0" align="center" style="margin:0 auto 24px;">
                <tr>
                  <td style="border-radius:999px;background:#6750A4;">
                    <a href="${escapeHtml(loginUrl)}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:500;color:#FFFFFF;text-decoration:none;border-radius:999px;">
                      Sign in
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;line-height:1.5;color:#79747E;">
                If you did not request this, you can safely ignore this email.
              </p>`;
  const html = emailShell({
    title: "Sign-in help",
    heading: "Use social sign-in",
    bodyHtml,
  });
  const text = [
    `Hi ${opts.username},`,
    "",
    `Your ${brand} account uses Google, GitHub, or Discord to sign in — there is no password to reset.`,
    `Sign in here: ${loginUrl}`,
    "",
    `If you did not request this, ignore this email.`,
  ].join("\n");

  try {
    await sendWithRetry({
      from: mailFromHeader(),
      to: opts.to,
      subject: `${brand} sign-in help`,
      text,
      html,
    });
  } catch (err) {
    console.error("[mail] OAuth reminder send failed", sanitizeMailError(err));
  }
}
