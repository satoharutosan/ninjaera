import { useEffect, useRef, useState } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CheckIcon from "@mui/icons-material/Check";
import imgGroup from "@/imports/84fed5e7-4fca-47a7-bdb9-cc0ba6ef4372.webp";
import { Page, useC, Field, FilledBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import { SocialAuthButtons } from "@/features/auth/SocialAuthButtons";
import { useUsernameField } from "@/shared/useUsernameField";
import { USERNAME_FORMAT_ERROR } from "@/shared/username";
import { setPageInLocationWithQuery } from "@/shared/routing";
import { BrandLogo } from "@/shared/BrandLogo";
import {
  beginSignupLegalReview,
  clearSignupLegalReview,
  loadSignupDraft,
  saveSignupDraft,
} from "@/features/auth/signupDraft";

function SignUpPage({ setPage }: {
  setPage: (p: Page) => void;
  onLogin?: (user: import("@/app/api").ApiUser) => void;
}) {
  const C = useC();
  const draft = useRef(loadSignupDraft()).current;
  const [email, setEmail] = useState(draft?.email ?? "");
  const usernameField = useUsernameField(draft?.username ?? "");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pw, setPw] = useState(draft?.password ?? "");
  const [confirmPw, setConfirmPw] = useState(draft?.confirmPassword ?? "");
  const [agreed, setAgreed] = useState(draft?.agreed ?? false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const checkboxRef = useRef<HTMLButtonElement>(null);
  const restoredFocus = useRef(false);

  const str = pw.length === 0 ? 0 : pw.length < 6 ? 1 : pw.length < 10 ? 2 : /[A-Z]/.test(pw) && /[0-9]/.test(pw) ? 4 : 3;
  const strLabel = ["", "Weak", "Fair", "Good", "Strong"];
  const strColor = ["", C.error, "#F59E0B", "#386A20", C.primary];

  // Persist draft while typing (session only; cleared after successful registration)
  useEffect(() => {
    saveSignupDraft({
      email,
      username: usernameField.value,
      password: pw,
      confirmPassword: confirmPw,
      agreed,
    });
  }, [email, usernameField.value, pw, confirmPw, agreed]);

  useEffect(() => {
    if (restoredFocus.current) return;
    if (draft?.agreed) {
      restoredFocus.current = true;
      // Return focus near consent after Accept from Terms/Privacy
      requestAnimationFrame(() => checkboxRef.current?.focus());
    }
  }, [draft?.agreed]);

  const persistAndOpenLegal = (page: "terms" | "privacy") => {
    saveSignupDraft({
      email,
      username: usernameField.value,
      password: pw,
      confirmPassword: confirmPw,
      agreed,
    });
    beginSignupLegalReview();
    setPageInLocationWithQuery(page, { from: "signup" });
    setPage(page);
  };

  const handleSignup = async () => {
    setError("");
    if (!agreed) { setError("Please accept the Terms of Service and Privacy Policy"); return; }
    if (pw !== confirmPw) { setError("Passwords do not match"); return; }
    if (pw.length < 6) { setError("Password must be at least 6 characters"); return; }
    const usernameErr = await usernameField.validateBeforeSubmit();
    if (usernameErr) {
      setError(usernameErr);
      return;
    }
    const username = usernameField.getTrimmed();
    if (!username) {
      setError(USERNAME_FORMAT_ERROR);
      return;
    }
    setLoading(true);
    try {
      const result = await api.auth.register(email.trim(), username, pw);
      clearSignupLegalReview();
      sessionStorage.setItem("pending-verify-email", result.email);
      if (result.emailStatus) sessionStorage.setItem("pending-verify-status", result.emailStatus);
      setPageInLocationWithQuery("verify-email", { email: result.email });
      setPage("verify-email");
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : "Registration failed";
      setError(msg);
      if (e instanceof ApiError && (e.status === 400 || e.status === 409) && /username/i.test(msg)) {
        usernameField.setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative" style={{ background: C.surfaceVar }}>
      <div className="absolute inset-0 overflow-hidden"><ImageWithFallback src={imgGroup} alt="" className="w-full h-full object-cover opacity-20" /></div>
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl p-8" style={{ background: C.surface, boxShadow: "0 8px 32px rgba(0,0,0,.16)" }}>
          <div className="text-center mb-8">
            <BrandLogo size={56} elevated className="mx-auto mb-4" priority />
            <h1 className="text-2xl font-light mb-1" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>Create <span className="font-medium">Account</span></h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Begin your shinobi journey today</p>
          </div>
          {error && <p className="text-sm mb-4 text-center" role="alert" style={{ color: C.error, fontFamily: "Roboto" }}>{error}</p>}
          <div className="space-y-5 mb-6">
            <Field label="Email" type="email" placeholder="ninja@example.com" value={email} onChange={setEmail} />
            <Field
              label="Username"
              placeholder="Letters, numbers, underscores"
              value={usernameField.value}
              error={usernameField.error || undefined}
              onChange={usernameField.setValue}
            />
            <div>
              <Field label="Password" type={showPw ? "text" : "password"} placeholder="Create a strong password" value={pw} onChange={setPw}
                suffix={<button type="button" onClick={() => setShowPw(!showPw)} style={{ color: C.onSurfaceVar }}>{showPw ? <VisibilityOffIcon style={{ fontSize: 20 }} /> : <VisibilityIcon style={{ fontSize: 20 }} />}</button>} />
              {pw.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">{[1, 2, 3, 4].map((i) => <div key={i} className="flex-1 h-1 rounded-full transition-all" style={{ background: i <= str ? strColor[str] : C.outlineVar }} />)}</div>
                  <span className="text-xs" style={{ color: strColor[str], fontFamily: "Roboto Mono,monospace" }}>{strLabel[str]}</span>
                </div>
              )}
            </div>
            <Field label="Confirm Password" type={showConfirmPw ? "text" : "password"} placeholder="Repeat your password" value={confirmPw} onChange={setConfirmPw}
              suffix={<button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} style={{ color: C.onSurfaceVar }}>{showConfirmPw ? <VisibilityOffIcon style={{ fontSize: 20 }} /> : <VisibilityIcon style={{ fontSize: 20 }} />}</button>} />

            <div className="flex items-start gap-3">
              <button
                ref={checkboxRef}
                type="button"
                role="checkbox"
                aria-checked={agreed}
                aria-label="I accept the Terms of Service and Privacy Policy"
                onClick={() => setAgreed((v) => !v)}
                className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
                style={{
                  borderColor: agreed ? C.primary : C.outline,
                  background: agreed ? C.primary : "transparent",
                  outlineColor: C.primary,
                }}
              >
                {agreed && <CheckIcon style={{ fontSize: 12, color: "white" }} aria-hidden />}
              </button>
              <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                I accept the{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  style={{ color: C.primary }}
                  onClick={() => persistAndOpenLegal("terms")}
                >
                  Terms of Service
                </button>
                {" "}and{" "}
                <button
                  type="button"
                  className="font-medium underline"
                  style={{ color: C.primary }}
                  onClick={() => persistAndOpenLegal("privacy")}
                >
                  Privacy Policy
                </button>
              </p>
            </div>
          </div>
          <FilledBtn onClick={handleSignup} cls="w-full justify-center mb-4" disabled={loading}>
            <PersonAddIcon style={{ fontSize: 16 }} />{loading ? "Creating…" : "Create Account"}
          </FilledBtn>
          <div className="flex items-center gap-3 mb-4"><div className="flex-1 h-px" style={{ background: C.outlineVar }} /><span className="text-xs" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>or continue with</span><div className="flex-1 h-px" style={{ background: C.outlineVar }} /></div>
          <SocialAuthButtons disabled={loading} onError={setError} />
          <p className="text-center text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>Already have an account? <button type="button" onClick={() => setPage("login")} className="font-medium" style={{ color: C.primary }}>Sign In</button></p>
        </div>
      </div>
    </div>
  );
}

export default SignUpPage;
