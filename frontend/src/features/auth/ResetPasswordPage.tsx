import { useEffect, useMemo, useRef, useState } from "react";
import CheckIcon from "@mui/icons-material/Check";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import imgHero from "@/imports/0f5a128a-ba81-4b49-a98d-77a79e4e65db.webp";
import { Page, useC, Field, FilledBtn, OutlinedBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import { BrandLogo } from "@/shared/BrandLogo";
import { hashQueryParams, setPageInLocation } from "@/shared/routing";

function passwordStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score += 1;
  if (/[0-9]/.test(pw)) score += 1;
  if (/[^A-Za-z0-9]/.test(pw)) score += 1;
  if (score <= 1) return { score, label: "Weak", color: "#B3261E" };
  if (score <= 3) return { score, label: "Okay", color: "#C47E00" };
  return { score, label: "Strong", color: "#386A20" };
}

function ResetPasswordPage({ setPage, onComplete }: {
  setPage: (p: Page) => void;
  onComplete?: () => void;
}) {
  const C = useC();
  const token = useMemo(() => hashQueryParams().get("token") || "", []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [redirectIn, setRedirectIn] = useState(3);
  const submitted = useRef(false);

  const strength = passwordStrength(password);

  useEffect(() => {
    if (!token) setError("This reset link is missing or invalid. Request a new one from the login page.");
  }, [token]);

  useEffect(() => {
    if (!success) return;
    if (redirectIn <= 0) {
      setPageInLocation("login");
      setPage("login");
      return;
    }
    const t = window.setTimeout(() => setRedirectIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [success, redirectIn, setPage]);

  const submit = async () => {
    setError("");
    if (!token) {
      setError("Invalid reset link");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
      setError("Password must include at least one letter and one number");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match");
      return;
    }
    if (loading || submitted.current) return;
    submitted.current = true;
    setLoading(true);
    try {
      await api.auth.resetPassword(token, password);
      onComplete?.();
      setSuccess(true);
      setRedirectIn(3);
    } catch (e) {
      submitted.current = false;
      setError(e instanceof ApiError ? e.message : "Could not reset password");
    } finally {
      setLoading(false);
    }
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
            <h1 className="text-2xl font-light mb-1" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
              Reset <span className="font-medium">Password</span>
            </h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Choose a new password for your account
            </p>
          </div>

          {success ? (
            <div className="text-center" role="status">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "#D7E8D4" }}
              >
                <CheckIcon style={{ fontSize: 22, color: "#386A20" }} />
              </div>
              <h2 className="font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                Password updated
              </h2>
              <p className="text-sm mb-6" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                You can sign in with your new password. Redirecting to login in {redirectIn}s…
              </p>
              <FilledBtn
                onClick={() => {
                  setPageInLocation("login");
                  setPage("login");
                }}
                cls="w-full justify-center"
              >
                Go to Login
              </FilledBtn>
            </div>
          ) : (
            <div
              className="space-y-5"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !loading) void submit();
              }}
            >
              {error && (
                <p className="text-sm text-center" style={{ color: C.error, fontFamily: "Roboto" }} role="alert">
                  {error}
                </p>
              )}
              <Field
                label="New password"
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
              {password.length > 0 && (
                <div aria-live="polite">
                  <div className="flex gap-1 mb-1">
                    {[0, 1, 2, 3].map((i) => (
                      <div
                        key={i}
                        className="h-1 flex-1 rounded-full"
                        style={{
                          background: strength.score > i ? strength.color : C.outlineVar,
                        }}
                      />
                    ))}
                  </div>
                  <p className="text-xs" style={{ color: strength.color, fontFamily: "Roboto" }}>
                    Strength: {strength.label}
                  </p>
                </div>
              )}
              <Field
                label="Confirm password"
                type={showConfirm ? "text" : "password"}
                placeholder="••••••••"
                value={confirm}
                onChange={setConfirm}
                suffix={
                  <button
                    type="button"
                    aria-label={showConfirm ? "Hide password" : "Show password"}
                    onClick={() => setShowConfirm(!showConfirm)}
                    style={{ color: C.onSurfaceVar }}
                  >
                    {showConfirm ? <VisibilityOffIcon style={{ fontSize: 20 }} /> : <VisibilityIcon style={{ fontSize: 20 }} />}
                  </button>
                }
              />
              <FilledBtn onClick={submit} cls="w-full justify-center" disabled={loading || !token}>
                {loading ? "Updating…" : "Update password"}
              </FilledBtn>
              <OutlinedBtn onClick={() => setPage("forgot-password")} cls="w-full justify-center">
                Request a new link
              </OutlinedBtn>
              <button
                type="button"
                className="w-full text-sm font-medium"
                style={{ color: C.primary, fontFamily: "Roboto" }}
                onClick={() => setPage("login")}
              >
                Back to Login
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
