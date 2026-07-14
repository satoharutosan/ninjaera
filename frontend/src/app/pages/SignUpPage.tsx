import { useState } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import CheckIcon from "@mui/icons-material/Check";
import imgGroup from "@/imports/84fed5e7-4fca-47a7-bdb9-cc0ba6ef4372.png";
import { Page, useC, SH3, Field, FilledBtn } from "@/app/shared";
import { api, setToken, ApiError } from "@/app/api";
import type { ApiUser } from "@/app/api";
import { SocialAuthButtons } from "@/app/components/SocialAuthButtons";

function SignUpPage({ setPage, onLogin }: {
  setPage:(p:Page)=>void;
  onLogin:(user: ApiUser)=>void;
}) {
  const C = useC();
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [showConfirmPw, setShowConfirmPw] = useState(false);
  const [pw, setPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const str = pw.length===0?0:pw.length<6?1:pw.length<10?2:/[A-Z]/.test(pw)&&/[0-9]/.test(pw)?4:3;
  const strLabel = ["","Weak","Fair","Good","Strong"];
  const strColor = ["",C.error,"#F59E0B","#386A20",C.primary];

  const handleSignup = async () => {
    setError("");
    if (!agreed) { setError("Please accept the Terms of Service"); return; }
    if (pw !== confirmPw) { setError("Passwords do not match"); return; }
    if (pw.length < 6) { setError("Password must be at least 6 characters"); return; }
    setLoading(true);
    try {
      const { token, user } = await api.auth.register(email, username, pw);
      setToken(token);
      onLogin(user);
      setPage("home");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-20 relative" style={{ background:C.surfaceVar }}>
      <div className="absolute inset-0 overflow-hidden"><ImageWithFallback src={imgGroup} alt="bg" className="w-full h-full object-cover opacity-20" /></div>
      <div className="relative w-full max-w-sm">
        <div className="rounded-3xl p-8" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.16)" }}>
          <div className="text-center mb-8">
            <div className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-bold mx-auto mb-4" style={{ background:C.primary, fontFamily:"Roboto", boxShadow:SH3 }}>NE</div>
            <h1 className="text-2xl font-light mb-1" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Create <span className="font-medium">Account</span></h1>
            <p className="text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Begin your shinobi journey today</p>
          </div>
          {error && <p className="text-sm mb-4 text-center" style={{ color:C.error, fontFamily:"Roboto" }}>{error}</p>}
          <div className="space-y-5 mb-6">
            <Field label="Email" type="email" placeholder="ninja@example.com" value={email} onChange={setEmail} />
            <Field label="Username" placeholder="Choose a unique name" value={username} onChange={setUsername} />
            <div>
              <Field label="Password" type={showPw?"text":"password"} placeholder="Create a strong password" value={pw} onChange={v => setPw(v)}
                suffix={<button type="button" onClick={() => setShowPw(!showPw)} style={{ color:C.onSurfaceVar }}>{showPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>} />
              {pw.length>0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">{[1,2,3,4].map(i => <div key={i} className="flex-1 h-1 rounded-full transition-all" style={{ background:i<=str?strColor[str]:C.outlineVar }} />)}</div>
                  <span className="text-xs" style={{ color:strColor[str], fontFamily:"Roboto Mono,monospace" }}>{strLabel[str]}</span>
                </div>
              )}
            </div>
            <Field label="Confirm Password" type={showConfirmPw?"text":"password"} placeholder="Repeat your password" value={confirmPw} onChange={setConfirmPw}
              suffix={<button type="button" onClick={() => setShowConfirmPw(!showConfirmPw)} style={{ color:C.onSurfaceVar }}>{showConfirmPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>} />
            <label className="flex items-start gap-3 cursor-pointer" onClick={() => setAgreed(!agreed)}>
              <div className="w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 mt-0.5 transition-colors" style={{ borderColor:agreed?C.primary:C.outline, background:agreed?C.primary:"transparent" }}>
                {agreed && <CheckIcon style={{ fontSize:12, color:"white" }} />}
              </div>
              <span className="text-sm leading-relaxed" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>I accept the <span style={{ color:C.primary }}>Terms of Service</span> and <span style={{ color:C.primary }}>Privacy Policy</span></span>
            </label>
          </div>
          <FilledBtn onClick={handleSignup} cls="w-full justify-center mb-4"><PersonAddIcon style={{ fontSize:16 }} />{loading ? "Creating..." : "Create Account"}</FilledBtn>
          <div className="flex items-center gap-3 mb-4"><div className="flex-1 h-px" style={{ background:C.outlineVar }} /><span className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>or continue with</span><div className="flex-1 h-px" style={{ background:C.outlineVar }} /></div>
          <SocialAuthButtons disabled={loading} onError={setError} />
          <p className="text-center text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Already have an account? <button type="button" onClick={() => setPage("login")} className="font-medium" style={{ color:C.primary }}>Sign In</button></p>
        </div>
      </div>
    </div>
  );
}

export default SignUpPage;
