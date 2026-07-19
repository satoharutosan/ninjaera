/**
 * Mail transport layer — decouples "how a message is delivered" from templates
 * and retry logic (which live in mail.ts).
 *
 * Two transports are supported behind one interface:
 *  - resend-http : Resend's HTTPS API (POST https://api.resend.com/emails).
 *                  Preferred on Railway because it uses port 443 and is never
 *                  blocked by the platform's outbound SMTP restrictions.
 *  - smtp        : nodemailer over SMTP (Gmail / SendGrid / Mailgun / SES /
 *                  Brevo / custom host). Forces IPv4 by default to dodge the
 *                  Gmail IPv6 ENETUNREACH failures seen on Railway.
 *
 * Selection is driven entirely by environment variables:
 *  - SMTP_PROVIDER=resend + RESEND_API_KEY (or SMTP_PASS) → resend-http
 *  - RESEND_API_KEY present                               → resend-http
 *  - MAIL_TRANSPORT=smtp                                  → force SMTP even for Resend
 *  - otherwise                                            → SMTP with provider preset
 */
import dns from "dns";
import nodemailer from "nodemailer";
import type { Transporter, TransportOptions } from "nodemailer";

export type MailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
};

export type MailSendResult = {
  messageId: string | null;
  accepted: string[];
};

export type MailTransportKind = "smtp" | "resend-http";

export interface MailTransport {
  readonly kind: MailTransportKind;
  readonly provider: string;
  readonly host: string;
  readonly port: number;
  readonly ipv4: boolean;
  verify(): Promise<void>;
  send(msg: MailMessage): Promise<MailSendResult>;
}

function env(name: string): string {
  return (process.env[name] || "").trim();
}

function envFlagTrue(name: string, defaultValue = false): boolean {
  const raw = env(name).toLowerCase();
  if (!raw) return defaultValue;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Master switch for outbound email.
 * Default false — no SMTP/Resend connection unless EMAIL_ENABLED=true.
 * Calls, sockets, and WebRTC must never depend on this subsystem.
 */
export function isEmailEnabled(): boolean {
  return envFlagTrue("EMAIL_ENABLED", false);
}

/** Resend API key: explicit RESEND_API_KEY, or SMTP_PASS when SMTP_PROVIDER=resend. */
export function resendApiKey(): string {
  const explicit = env("RESEND_API_KEY");
  if (explicit) return explicit;
  if (env("SMTP_PROVIDER").toLowerCase() === "resend") return env("SMTP_PASS");
  return "";
}

/** True when we should deliver via Resend's HTTPS API instead of SMTP. */
export function useResendHttp(): boolean {
  if (env("MAIL_TRANSPORT").toLowerCase() === "smtp") return false;
  return Boolean(resendApiKey());
}

// ---------------------------------------------------------------------------
// SMTP presets
// ---------------------------------------------------------------------------

export type SmtpPreset = {
  host: string;
  port: number;
  secure: boolean;
  defaultUser?: string;
  hint: string;
};

export function resolveSmtpPreset(): SmtpPreset {
  const provider = env("SMTP_PROVIDER").toLowerCase();
  switch (provider) {
    case "resend":
      return {
        host: "smtp.resend.com",
        port: 465,
        secure: true,
        defaultUser: "resend",
        hint: "Resend: prefer the HTTP API (set RESEND_API_KEY). SMTP fallback: SMTP_USER=resend, SMTP_PASS=<API key>.",
      };
    case "sendgrid":
      return {
        host: "smtp.sendgrid.net",
        port: 587,
        secure: false,
        defaultUser: "apikey",
        hint: "SendGrid: SMTP_USER=apikey, SMTP_PASS=<API key>",
      };
    case "mailgun":
      return {
        host: env("SMTP_HOST") || "smtp.mailgun.org",
        port: 587,
        secure: false,
        hint: "Mailgun: SMTP_USER=<smtp login>, SMTP_PASS=<smtp password>",
      };
    case "ses":
    case "aws":
    case "amazon":
      return {
        host: env("SMTP_HOST") || "email-smtp.us-east-1.amazonaws.com",
        port: 587,
        secure: false,
        hint: "Amazon SES: set SMTP_HOST to your region endpoint, SMTP_USER/SMTP_PASS = SMTP credentials",
      };
    case "brevo":
    case "sendinblue":
      return {
        host: "smtp-relay.brevo.com",
        port: 587,
        secure: false,
        hint: "Brevo: SMTP_USER=<login email>, SMTP_PASS=<SMTP key>",
      };
    case "gmail":
    case "":
    default:
      return {
        host: env("SMTP_HOST") || "smtp.gmail.com",
        port: Number(env("SMTP_PORT") || "587") || 587,
        secure: env("SMTP_SECURE") === "true" || Number(env("SMTP_PORT") || "587") === 465,
        hint:
          "Gmail on Railway often times out / has IPv6 issues. Prefer SMTP_PROVIDER=resend + RESEND_API_KEY. " +
          "If keeping Gmail: App Password + SMTP_IP_FAMILY=4.",
      };
  }
}

export function smtpProviderHint(): string {
  return resolveSmtpPreset().hint;
}

/** Force IPv4 DNS lookups — Railway containers frequently cannot reach Gmail AAAA (ENETUNREACH). */
function ipv4Lookup(
  hostname: string,
  _options: unknown,
  callback: (err: NodeJS.ErrnoException | null, address: string, family: number) => void,
) {
  dns.lookup(hostname, { family: 4 }, callback);
}

function smtpTransportOptions() {
  const preset = resolveSmtpPreset();
  const host = env("SMTP_HOST") || preset.host;
  const port = Number(env("SMTP_PORT") || String(preset.port)) || preset.port;
  const secure = env("SMTP_SECURE") === "true" || port === 465 || (env("SMTP_SECURE") === "" && preset.secure);
  const user = env("SMTP_USER") || preset.defaultUser || "";
  const pass = env("SMTP_PASS");

  const familyRaw = (env("SMTP_IP_FAMILY") || "4").trim().toLowerCase();
  const forceIpv4 = familyRaw !== "0" && familyRaw !== "auto" && familyRaw !== "6";

  return {
    host,
    port,
    secure,
    requireTLS: !secure && port === 587,
    auth: { user, pass },
    ...(forceIpv4 ? { family: 4 as const, lookup: ipv4Lookup } : {}),
    pool: true,
    maxConnections: 2,
    maxMessages: 50,
    connectionTimeout: 20_000,
    greetingTimeout: 20_000,
    socketTimeout: 30_000,
    tls: { minVersion: "TLSv1.2" as const, servername: host },
  };
}

// ---------------------------------------------------------------------------
// Transports
// ---------------------------------------------------------------------------

function createSmtpTransport(): MailTransport {
  const opts = smtpTransportOptions();
  let tx: Transporter | null = null;
  const get = () => (tx ??= nodemailer.createTransport(opts as TransportOptions));
  return {
    kind: "smtp",
    provider: env("SMTP_PROVIDER") || "gmail",
    host: opts.host,
    port: opts.port,
    ipv4: Boolean((opts as { family?: number }).family === 4),
    async verify() {
      await get().verify();
    },
    async send(msg) {
      const info = await get().sendMail(msg);
      return {
        messageId: info.messageId || null,
        accepted: (info.accepted as string[] | undefined)?.map(String) || [],
      };
    },
  };
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";

function createResendHttpTransport(): MailTransport {
  const apiKey = resendApiKey();
  return {
    kind: "resend-http",
    provider: "resend",
    host: "api.resend.com",
    port: 443,
    ipv4: true,
    async verify() {
      // Lightweight auth check: the domains endpoint returns 200 for a valid key.
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) {
        throw Object.assign(new Error("Resend API key rejected (invalid or revoked)"), {
          code: "EAUTH",
          responseCode: 535,
        });
      }
      if (!res.ok) {
        throw Object.assign(new Error(`Resend API verify failed (HTTP ${res.status})`), {
          code: "ECONNECTION",
          responseCode: res.status,
        });
      }
    },
    async send(msg) {
      const res = await fetch(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: msg.from,
          to: [msg.to],
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.headers ? { headers: msg.headers } : {}),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
      if (!res.ok) {
        const message = data.message || data.name || `Resend API error (HTTP ${res.status})`;
        throw Object.assign(new Error(message), {
          code: res.status === 401 || res.status === 403 ? "EAUTH" : "ECONNECTION",
          responseCode: res.status,
        });
      }
      return { messageId: data.id || null, accepted: [msg.to] };
    },
  };
}

let cached: MailTransport | null = null;

function createDisabledTransport(): MailTransport {
  const err = () => {
    throw Object.assign(new Error("Email is disabled (EMAIL_ENABLED=false)"), { code: "EMAIL_DISABLED" });
  };
  return {
    kind: "smtp",
    provider: "disabled",
    host: "",
    port: 0,
    ipv4: true,
    async verify() { err(); },
    async send() { return err(); },
  };
}

/**
 * Resolve the active transport (cached).
 * Does not open an SMTP socket until verify()/send() — and never when EMAIL_ENABLED=false.
 */
export function getMailTransport(): MailTransport {
  if (!isEmailEnabled()) return createDisabledTransport();
  if (cached) return cached;
  cached = useResendHttp() ? createResendHttpTransport() : createSmtpTransport();
  return cached;
}

export function resetMailTransportCache(): void {
  cached = null;
}
