import { useState } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import LoginIcon from "@mui/icons-material/Login";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CheckIcon from "@mui/icons-material/Check";
import imgHero from "@/imports/0f5a128a-ba81-4b49-a98d-77a79e4e65db.webp";
import { Page, useC, Field, FilledBtn, TonalBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import type { ApiUser } from "@/app/api";
import { SocialAuthButtons } from "@/features/auth/SocialAuthButtons";
import { setPageInLocationWithQuery } from "@/shared/routing";
import { BrandLogo } from "@/shared/BrandLogo";
import {
  persistAuthSession,
  isAuthPersistent,
  setAuthPersistent,
  getRememberedEmail,
  setRememberedEmail,
} from "@/shared/authStorage";

function LoginPage({ setPage, onLogin }: {
  setPage: (p: Page) => void;
  onLogin: (user: ApiUser) => void;
}) {
  const C = useC();
  const [email, setEmail] = useState(() => getRememberedEmail());
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [staySignedIn, setStaySignedIn] = useState(() => isAuthPersistent());
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [unverifiedEmail, setUnverifiedEmail] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendInfo, setResendInfo] = useState("");

  const handleLogin = async () => {
    if (loading) return;
    setError("");
    setUnverifiedEmail(null);
    setResendInfo("");
    setLoading(true);
    try {
      const { token, user } = await api.auth.login(email.trim(), password);
      persistAuthSession(token, user, staySignedIn);
      setRememberedEmail(email.trim());
      onLogin(user);
      setPage("home");
    } catch (e) {
      if (e instanceof ApiError && e.data.code === "EMAIL_NOT_VERIFIED") {
        const pendingEmail = typeof e.data.email === "string" ? e.data.email : email.trim();
        setUnverifiedEmail(pendingEmail);
        setError(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendVerification = async () => {
    if (!unverifiedEmail) return;
    setResending(true);
    setResendInfo("");
    try {
      await api.auth.resendVerification(unverifiedEmail);
      sessionStorage.setItem("pending-verify-email", unverifiedEmail);
      setPageInLocationWithQuery("verify-email", { email: unverifiedEmail });
      setPage("verify-email");
    } catch (e) {
      setResendInfo(e instanceof ApiError ? e.message : "Could not resend verification email");
    } finally {
      setResending(false);
    }
  };

  const toggleStaySignedIn = () => {
    const next = !staySignedIn;
    setStaySignedIn(next);
    setAuthPersistent(next);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative" style={{ background: C.surfaceVar }}>
      <div data-nav-hero className="absolute inset-0 overflow-hidden" aria-hidden>
        <ImageWithFallback src={imgHero} alt="" className="w-full h-full object-cover opacity-40" />
        <div className="absolute inset-0 bg-black/30" />
      </div>
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl p-8" style={{ background: C.surface, boxShadow: "0 8px 32px rgba(0,0,0,.16)" }}>
          <div className="text-center mb-8">
            <BrandLogo size={56} elevated className="mx-auto mb-4" priority />
            <h1 className="text-2xl font-light mb-1" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>Welcome <span className="font-medium">Back</span></h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Sign in to continue your journey</p>
          </div>
          {error && <p className="text-sm mb-3 text-center" style={{ color: C.error, fontFamily: "Roboto" }} role="alert">{error}</p>}
          {unverifiedEmail && (
            <div className="mb-4 p-3 rounded-2xl" style={{ background: C.primaryCont }}>
              <p className="text-sm mb-2" style={{ color: C.onPrimaryCont, fontFamily: "Roboto" }}>
                Verify <strong>{unverifiedEmail}</strong> before signing in.
              </p>
              <TonalBtn onClick={handleResendVerification} cls="w-full justify-center" disabled={resending}>
                {resending ? "Sending…" : "Resend verification email"}
              </TonalBtn>
              <button
                type="button"
                className="w-full mt-2 text-sm font-medium"
                style={{ color: C.primary, fontFamily: "Roboto" }}
                onClick={() => {
                  sessionStorage.setItem("pending-verify-email", unverifiedEmail);
                  setPageInLocationWithQuery("verify-email", { email: unverifiedEmail });
                  setPage("verify-email");
                }}
              >
                Enter verification code
              </button>
              {resendInfo && <p className="text-xs mt-2 text-center" style={{ color: C.error, fontFamily: "Roboto" }}>{resendInfo}</p>}
            </div>
          )}
          <div className="space-y-5 mb-6" onKeyDown={(e) => { if (e.key === "Enter" && !loading) void handleLogin(); }}>
            <Field label="Email" type="email" placeholder="ninja@example.com" value={email} onChange={setEmail} />
            <Field
              label="Password"
              type={showPw ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={setPassword}
              suffix={
                <button
                  type="button"
                  aria-label={showPw ? "Hide password" : "Show password"}
                  onClick={() => setShowPw(!showPw)}
                  style={{ color: C.onSurfaceVar }}
                >
                  {showPw ? <VisibilityOffIcon style={{ fontSize: 20 }} /> : <VisibilityIcon style={{ fontSize: 20 }} />}
                </button>
              }
            />
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                role="checkbox"
                aria-checked={staySignedIn}
                aria-label="Stay signed in across browser restarts"
                title={staySignedIn ? "You stay signed in until you log out" : "Signed out when you close the browser"}
                onClick={toggleStaySignedIn}
                className="flex items-center gap-2 text-left"
              >
                <span
                  className="w-4 h-4 rounded border-2 flex items-center justify-center shrink-0"
                  style={{
                    borderColor: C.primary,
                    background: staySignedIn ? C.primary : "transparent",
                  }}
                  aria-hidden
                >
                  {staySignedIn && <CheckIcon style={{ fontSize: 10, color: "white" }} />}
                </span>
                <span className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Stay signed in</span>
              </button>
              <button
                type="button"
                onClick={() => setPage("forgot-password")}
                className="text-sm font-medium shrink-0"
                style={{ color: C.primary, fontFamily: "Roboto" }}
              >
                Forgot password?
              </button>
            </div>
          </div>
          <FilledBtn onClick={handleLogin} cls="w-full justify-center mb-4" disabled={loading}>
            <LoginIcon style={{ fontSize: 16 }} />
            {loading ? "Signing in..." : "Sign In"}
          </FilledBtn>
          <div className="flex items-center gap-3 mb-4"><div className="flex-1 h-px" style={{ background: C.outlineVar }} /><span className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>or continue with</span><div className="flex-1 h-px" style={{ background: C.outlineVar }} /></div>
          <SocialAuthButtons
            disabled={loading}
            onError={setError}
            staySignedIn={staySignedIn}
          />
          <p className="text-center text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            {"Don't have an account? "}
            <button type="button" onClick={() => setPage("signup")} className="font-medium" style={{ color: C.primary }}>Create Account</button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
