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
      setInfo("If a pending registration exists for that email, a new verification message has been sent.");
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
      <div className="absolute inset-0 overflow-hidden">
        <ImageWithFallback src={imgGroup} alt="" className="w-full h-full object-cover opacity-20" />
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
                : "We sent a verification code to your inbox. Your account stays inactive until you verify."}
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

          {success ? (
            <FilledBtn onClick={() => setPage("home")} cls="w-full justify-center">
              Continue to Home
            </FilledBtn>
          ) : (
            <>
              <div className="space-y-4 mb-5" onKeyDown={(e) => { if (e.key === "Enter" && !loading) handleVerifyCode(); }}>
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
              </div>

              <p className="text-xs text-center mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Check spam or promotions if you do not see the message. Codes expire after 15 minutes.
              </p>
              <p className="text-center text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Wrong email?{" "}
                <button type="button" onClick={() => setPage("signup")} className="font-medium" style={{ color: C.primary }}>
                  Register again
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
