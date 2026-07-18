import { useEffect, useState } from "react";
import CheckIcon from "@mui/icons-material/Check";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import imgHero from "@/imports/0f5a128a-ba81-4b49-a98d-77a79e4e65db.webp";
import { Page, useC, Field, FilledBtn, OutlinedBtn, TonalBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";
import { BrandLogo } from "@/shared/BrandLogo";
import { getRememberedEmail } from "@/shared/authStorage";

function ForgotPasswordPage({ setPage }: { setPage: (p: Page) => void }) {
  const C = useC();
  const [email, setEmail] = useState(() => getRememberedEmail());
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(t);
  }, [cooldown]);

  const submit = async () => {
    setError("");
    setInfo("");
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address");
      return;
    }
    if (loading || cooldown > 0) return;
    setLoading(true);
    try {
      const r = await api.auth.forgotPassword(trimmed);
      setSent(true);
      setInfo(r.message || "If that email is registered, a reset link is on its way.");
      setCooldown(60);
    } catch (e) {
      if (e instanceof ApiError && e.status === 429) {
        setError(e.message);
        setCooldown(60);
      } else {
        // Still show success-style confirmation for most failures to avoid enumeration;
        // surface config/send errors clearly.
        const msg = e instanceof ApiError ? e.message : "Could not send reset email";
        if (e instanceof ApiError && (e.status === 503 || e.data.code === "SMTP_NOT_CONFIGURED" || e.data.code === "SMTP_SEND_FAILED")) {
          setError(msg);
        } else {
          setSent(true);
          setInfo("If that email is registered, a reset link is on its way.");
          setCooldown(60);
        }
      }
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
              Forgot <span className="font-medium">Password</span>
            </h1>
            <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Enter your account email and we will send a secure reset link.
            </p>
          </div>

          {sent ? (
            <div className="text-center" role="status">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ background: "#D7E8D4" }}
              >
                <CheckIcon style={{ fontSize: 22, color: "#386A20" }} />
              </div>
              <h2 className="font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
                Check your inbox
              </h2>
              <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                {info || "If that email is registered with a password, you will receive a reset link shortly."}
              </p>
              <p className="text-xs mb-6" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                The link expires in about 20 minutes and can only be used once. Check spam if you do not see it.
              </p>
              <div className="flex flex-col gap-3">
                <TonalBtn
                  onClick={() => {
                    if (cooldown > 0 || loading) return;
                    setSent(false);
                    setInfo("");
                  }}
                  cls="w-full justify-center"
                  disabled={cooldown > 0 || loading}
                >
                  {cooldown > 0 ? `Resend available in ${cooldown}s` : "Resend email"}
                </TonalBtn>
                <OutlinedBtn onClick={() => setPage("login")} cls="w-full justify-center">
                  Back to Login
                </OutlinedBtn>
              </div>
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
                label="Email"
                type="email"
                placeholder="ninja@example.com"
                value={email}
                onChange={setEmail}
              />
              <FilledBtn onClick={submit} cls="w-full justify-center" disabled={loading}>
                {loading ? "Sending…" : "Send reset link"}
              </FilledBtn>
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

export default ForgotPasswordPage;
