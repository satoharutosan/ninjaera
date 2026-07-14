import { useState } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import LoginIcon from "@mui/icons-material/Login";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CheckIcon from "@mui/icons-material/Check";
import imgHero from "@/imports/0f5a128a-ba81-4b49-a98d-77a79e4e65db.png";
import { Page, useC, SH3, Field, FilledBtn, OutlinedBtn, TonalBtn } from "@/app/shared";
import { api, setToken, ApiError } from "@/app/api";
import type { ApiUser } from "@/app/api";
import { SocialAuthButtons } from "@/app/components/SocialAuthButtons";

function LoginPage({ setPage, onLogin }: {
  setPage:(p:Page)=>void;
  onLogin:(user: ApiUser)=>void;
}) {
  const C = useC();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [modal, setModal] = useState(false);
  const [sent, setSent] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const { token, user } = await api.auth.login(email, password);
      setToken(token);
      onLogin(user);
      setPage("home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    try {
      await api.auth.forgotPassword(resetEmail);
      setSent(true);
    } catch {
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative" style={{ background:C.surfaceVar }}>
      <div className="absolute inset-0 overflow-hidden"><ImageWithFallback src={imgHero} alt="bg" className="w-full h-full object-cover opacity-20" /></div>
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl p-8" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.16)" }}>
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold mx-auto mb-4" style={{ background:C.primary, fontFamily:"Roboto", boxShadow:SH3 }}>NE</div>
            <h1 className="text-2xl font-light mb-1" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Welcome <span className="font-medium">Back</span></h1>
            <p className="text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Sign in to continue your journey</p>
          </div>
          {error && <p className="text-sm mb-4 text-center" style={{ color:C.error, fontFamily:"Roboto" }}>{error}</p>}
          <div className="space-y-5 mb-6" onKeyDown={e => { if (e.key === "Enter" && !loading) handleLogin(); }}>
            <Field label="Email" type="email" placeholder="ninja@example.com" value={email} onChange={setEmail} />
            <Field label="Password" type={showPw?"text":"password"} placeholder="••••••••" value={password} onChange={setPassword}
              suffix={<button type="button" onClick={() => setShowPw(!showPw)} style={{ color:C.onSurfaceVar }}>{showPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>} />
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <div className="w-4 h-4 rounded border-2 flex items-center justify-center" style={{ borderColor:C.outline }}><CheckIcon style={{ fontSize:10, color:C.primary }} /></div>
                <span className="text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Remember me</span>
              </label>
              <button type="button" onClick={() => setModal(true)} className="text-sm font-medium" style={{ color:C.primary, fontFamily:"Roboto" }}>Forgot password?</button>
            </div>
          </div>
          <FilledBtn onClick={handleLogin} cls="w-full justify-center mb-4"><LoginIcon style={{ fontSize:16 }} />{loading ? "Signing in..." : "Sign In"}</FilledBtn>
          <div className="flex items-center gap-3 mb-4"><div className="flex-1 h-px" style={{ background:C.outlineVar }} /><span className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>or continue with</span><div className="flex-1 h-px" style={{ background:C.outlineVar }} /></div>
          <SocialAuthButtons disabled={loading} onError={setError} />
          <p className="text-center text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{"Don't have an account? "}<button type="button" onClick={() => setPage("signup")} className="font-medium" style={{ color:C.primary }}>Create Account</button></p>
        </div>
      </div>
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px] p-4" onClick={() => setModal(false)}>
          <div className="rounded-3xl p-6 w-full max-w-sm" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.20)" }} onClick={e => e.stopPropagation()}>
            {sent ? (
              <div className="text-center">
                <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:"#D7E8D4" }}><CheckIcon style={{ fontSize:22, color:"#386A20" }} /></div>
                <h3 className="font-medium mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Email Sent!</h3>
                <p className="text-sm mb-4" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Check your inbox for the reset link.</p>
                <TonalBtn onClick={() => { setModal(false); setSent(false); }}>Done</TonalBtn>
              </div>
            ) : (
              <>
                <h3 className="text-lg font-medium mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Reset Password</h3>
                <p className="text-sm mb-5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Enter your email to receive a reset link.</p>
                <Field label="Email" type="email" placeholder="your@email.com" value={resetEmail} onChange={setResetEmail} />
                <div className="flex gap-3 mt-5">
                  <OutlinedBtn onClick={() => setModal(false)} cls="flex-1 justify-center">Cancel</OutlinedBtn>
                  <FilledBtn onClick={handleForgot} cls="flex-1 justify-center">Send Link</FilledBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default LoginPage;
