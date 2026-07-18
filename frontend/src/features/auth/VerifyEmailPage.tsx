import { useEffect, useRef, useState } from "react";
import MailOutlineIcon from "@mui/icons-material/MailOutline";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import imgGroup from "@/imports/84fed5e7-4fca-47a7-bdb9-cc0ba6ef4372.webp";
import { Page, useC, Field, FilledBtn, OutlinedBtn, TonalBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import type { ApiUser } from "@/app/api";
import { hashQueryParams, setPageInLocationWithQuery } from "@/shared/routing";
import { BrandLogo } from "@/shared/BrandLogo";
import { persistAuthSession, isAuthPersistent } from "@/shared/authStorage";
import { clearSignupDraft } from "@/features/auth/signupDraft";

type DeliveryStatus = "queued" | "sending" | "sent" | "failed" | "none";

function openMailApp() {
  // mailto: opens the default mail client; Gmail/web users can still use their inbox manually.
  window.location.href = "mailto:";
}

function VerifyEmailPage({ setPage, onLogin }: {
  setPage: (p: Page) => void;
  onLogin: (user: ApiUser) => void;
}) {
  const C = useC();
  const params = hashQueryParams();
  const [email, setEmail] = useState(() => params.get("email") || sessionStorage.getItem("pending-verify-email") || "");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [success, setSuccess] = useState(false);
  const [deliveryStatus, setDeliveryStatus] = useState<DeliveryStatus>(() => {
    const stored = sessionStorage.getItem("pending-verify-status");
    return stored === "queued" || stored === "sending" || stored === "sent" || stored === "failed" ? stored : "queued";
  });
  const tokenHandled = useRef(false);

  useEffect(() => {
    if (email) sessionStorage.setItem("pending-verify-email", email);
  }, [email]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  useEffect(() => {
    if (!email || success || tokenHandled.current) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async () => {
      try {
        const status = await api.auth.verificationStatus(email.trim());
        if (cancelled) return;
        setDeliveryStatus(status.status);
        sessionStorage.setItem("pending-verify-status", status.status);
        setCooldown(status.cooldownSeconds || 0);
        if (status.status === "sent") {
          setInfo("Verification email sent. Enter the code from your inbox to activate your account.");
        } else if (status.status === "failed") {
          setInfo("");
        } else if (status.status === "queued" || status.status === "sending") {
          setInfo("Your verification email is being sent in the background.");
        }
      } catch {
        /* Status is best-effort; verification/resend buttons remain usable. */
      } finally {
        if (!cancelled && deliveryStatus !== "sent") {
          timer = window.setTimeout(refresh, 5000);
        }
      }
    };
    void refresh();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [email, success, deliveryStatus]);

  useEffect(() => {
    const token = hashQueryParams().get("token");
    if (!token || tokenHandled.current) return;
    tokenHandled.current = true;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const result = await api.auth.verifyEmail({ token });
        persistAuthSession(result.token, result.user, isAuthPersistent());
        onLogin(result.user);
        sessionStorage.removeItem("pending-verify-email");
        sessionStorage.removeItem("pending-verify-status");
        clearSignupDraft();
        setSuccess(true);
        setInfo("Your email is verified. Welcome to Ninja Era!");
        setPage("home");
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Verification link is invalid or expired");
      } finally {
        setLoading(false);
      }
    })();
  }, [onLogin, setPage]);

  const handleVerifyCode = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Enter the email address you registered with");
      return;
    }
    if (!/^\d{6}$/.test(code.trim())) {
      setError("Enter the 6-digit verification code from your email");
      return;
    }
    setLoading(true);
    try {
      const result = await api.auth.verifyEmail({ email: email.trim(), code: code.trim() });
      persistAuthSession(result.token, result.user, isAuthPersistent());
      onLogin(result.user);
      sessionStorage.removeItem("pending-verify-email");
      sessionStorage.removeItem("pending-verify-status");
      clearSignupDraft();
      setSuccess(true);
      setInfo("Your email is verified. Welcome to Ninja Era!");
      setPage("home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Verification failed");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError("");
    setInfo("");
    if (!email.trim()) {
      setError("Enter your email address to resend the code");
      return;
    }
    if (cooldown > 0) return;
    setResending(true);
    try {
      const result = await api.auth.resendVerification(email.trim());
      setCooldown(result.cooldownSeconds || 60);
      setDeliveryStatus(result.emailStatus || "queued");
      sessionStorage.setItem("pending-verify-status", result.emailStatus || "queued");
      setInfo("Verification email queued. You can stay here while it sends in the background.");
      setPageInLocationWithQuery("verify-email", { email: email.trim() });
    } catch (e) {
      if (e instanceof ApiError) {
        setError(e.message);
        const retry = typeof e.data.retryAfter === "number" ? e.data.retryAfter : 0;
        if (retry > 0) setCooldown(retry);
      } else {
        setError("Could not resend verification email");
      }
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative" style={{ background: C.surfaceVar }}>
      <div data-nav-hero className="absolute inset-0 overflow-hidden" aria-hidden>
        <ImageWithFallback src={imgGroup} alt="" className="w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-black/30" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl p-8" style={{ background: C.surface, boxShadow: "0 8px 32px rgba(0,0,0,.16)" }}>
          <div className="text-center mb-6">
            <BrandLogo size={56} elevated className="mx-auto mb-4" priority />
            <h1 className="text-2xl font-light mb-1" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
              {success ? "Email " : "Verify "}
              <span className="font-medium">{success ? "Verified" : "Email"}</span>
            </h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              {success
                ? "Your account is ready. You can continue into Ninja Era."
                : "Your account is pending verification. Email delivery happens in the background so you can stay on this page."}
            </p>
          </div>

          {error && (
            <p className="text-sm mb-4 text-center" role="alert" style={{ color: C.error, fontFamily: "Roboto" }}>
              {error}
            </p>
          )}
          {info && !error && (
            <p className="text-sm mb-4 text-center" role="status" style={{ color: "#386A20", fontFamily: "Roboto" }}>
              {info}
            </p>
          )}
          {deliveryStatus === "failed" && !success && (
            <div className="rounded-2xl p-4 mb-4" role="alert" style={{ background: "#FCEEEE", color: C.error, fontFamily: "Roboto" }}>
              <p className="text-sm font-medium mb-1">We couldn't send your verification email.</p>
              <p className="text-xs leading-relaxed">
                Your pending account is still saved. Retry delivery, change the email address, or contact support.
              </p>
            </div>
          )}

          {success ? (
            <FilledBtn onClick={() => setPage("home")} cls="w-full justify-center">
              Continue to Home
            </FilledBtn>
          ) : (
            <>
              <div className="space-y-4 mb-5" onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleVerifyCode(); }}>
                <div className="rounded-2xl px-4 py-3 flex items-start gap-3" style={{ background: C.surfaceVar, color: C.onSurfaceVar }}>
                  <MailOutlineIcon style={{ fontSize: 20, color: C.primary, marginTop: 1 }} />
                  <div className="min-w-0">
                    <p className="text-xs" style={{ fontFamily: "Roboto" }}>Verification code for</p>
                    <p className="text-sm font-medium truncate" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                      {email || "your email address"}
                    </p>
                    <p className="text-xs mt-1 capitalize" style={{ fontFamily: "Roboto Mono, monospace" }}>
                      Email status: {deliveryStatus === "none" ? "pending lookup" : deliveryStatus}
                    </p>
                  </div>
                </div>
                <Field
                  label="Email"
                  type="email"
                  placeholder="ninja@example.com"
                  value={email}
                  onChange={setEmail}
                />
                <Field
                  label="6-digit code"
                  type="text"
                  placeholder="482913"
                  value={code}
                  onChange={(v) => setCode(v.replace(/\D/g, "").slice(0, 6))}
                />
              </div>

              <FilledBtn
                onClick={handleVerifyCode}
                cls="w-full justify-center mb-3"
                disabled={loading}
              >
                {loading ? "Verifying…" : "Verify and activate"}
              </FilledBtn>

              <div className="flex flex-col gap-2 mb-4">
                <TonalBtn
                  onClick={handleResend}
                  cls="w-full justify-center"
                  disabled={resending || cooldown > 0 || loading}
                >
                  {cooldown > 0
                    ? `Resend available in ${cooldown}s`
                    : resending
                      ? "Sending…"
                      : "Resend verification email"}
                </TonalBtn>
                <OutlinedBtn onClick={openMailApp} cls="w-full justify-center">
                  <MailOutlineIcon style={{ fontSize: 16 }} /> Open email app
                </OutlinedBtn>
                {deliveryStatus === "failed" && (
                  <>
                    <OutlinedBtn onClick={() => setPage("signup")} cls="w-full justify-center">
                      Change Email Address
                    </OutlinedBtn>
                    <OutlinedBtn onClick={() => setPage("contact")} cls="w-full justify-center">
                      Contact Support
                    </OutlinedBtn>
                  </>
                )}
              </div>

              <p className="text-xs text-center mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Check spam or promotions if you do not see the message. Codes expire after 15 minutes.
              </p>
              <p className="text-center text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Wrong email?{" "}
                <button type="button" onClick={() => setPage("signup")} className="font-medium" style={{ color: C.primary }}>
                  Change email
                </button>
                {" · "}
                <button type="button" onClick={() => setPage("login")} className="font-medium" style={{ color: C.primary }}>
                  Sign in
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default VerifyEmailPage;
