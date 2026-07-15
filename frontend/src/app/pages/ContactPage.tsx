import { useState } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import SendIcon from "@mui/icons-material/Send";
import imgMoonlight from "@/imports/ca45f148-ce4c-4dfa-b709-6b24cd36cd25.png";
import imgKunoichi from "@/imports/ChatGPT_Image_Jul_7__2026__10_32_45_AM.png";
import { useC, useWide, SH2, Field, FilledBtn, TonalBtn } from "@/app/shared";
import { api, ApiError } from "@/app/api";

function ContactPage() {
  const C = useC();
  const isLight = C.bg === "#FFFBFE";
  const isMobile = !useWide(767);
  /** Slightly translucent field fill on mobile so the form background image peeks through. */
  const fieldBg = isMobile
    ? (isLight ? "rgba(255,251,254,0.72)" : "rgba(29,27,32,0.62)")
    : undefined;
  const [sent, setSent] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("General");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    setError("");
    if (!name || !email || !subject || !message) {
      setError("Please fill in all fields");
      return;
    }
    setLoading(true);
    try {
      await api.contact.submit({ name, email, subject, category, message });
      setSent(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Failed to send message");
    } finally {
      setLoading(false);
    }
  };

  const formInner = sent ? (
    <div className="flex-1 flex flex-col items-center justify-center text-center py-10">
      <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:"#D7E8D4" }}><CheckIcon style={{ fontSize:28, color:"#386A20" }} /></div>
      <h3 className="text-xl font-medium mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Message Sent!</h3>
      <p className="text-sm mb-6" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{"We'll respond within 24 hours."}</p>
      <TonalBtn onClick={() => setSent(false)}>Send Another</TonalBtn>
    </div>
  ) : (
    <div className="flex flex-col flex-1 gap-0">
      <h2 className="text-2xl font-light mb-7" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Send a <span className="font-medium">Message</span></h2>
      {error && <p className="text-sm mb-4" style={{ color:C.error, fontFamily:"Roboto" }}>{error}</p>}
      <div className="flex flex-col flex-1 gap-6">
        <Field label="Name" placeholder="Your name" value={name} onChange={setName} bg={fieldBg} />
        <Field label="Email" type="email" placeholder="your@email.com" value={email} onChange={setEmail} bg={fieldBg} />
        <Field label="Subject" placeholder="What is this about?" value={subject} onChange={setSubject} bg={fieldBg} />
        <div className="relative mt-1">
          <select
            value={category}
            onChange={e => setCategory(e.target.value)}
            className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none appearance-none"
            style={{ borderColor:C.outline, color:C.onSurface, background: fieldBg ?? C.surface, fontFamily:"Roboto" }}
          >
            {["General","Bug Report","Account","Billing","Partnership"].map(o => <option key={o}>{o}</option>)}
          </select>
          <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Category</span>
          <ExpandMoreIcon style={{ fontSize:20, color:C.onSurfaceVar, position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} />
        </div>
        <Field label="Message" placeholder="Write your message..." rows={8} value={message} onChange={setMessage} cls="flex-1" bg={fieldBg} />
        <FilledBtn onClick={handleSubmit} cls="w-full justify-center"><SendIcon style={{ fontSize:16 }} />{loading ? "Sending..." : "Send Message"}</FilledBtn>
      </div>
    </div>
  );

  return (
    <div style={{ background:C.bg }} className="pt-16">
      <div className="relative h-[50vh] overflow-hidden">
        <ImageWithFallback src={imgMoonlight} alt="Contact" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-center justify-center"><h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>Contact</h1></div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="grid md:grid-cols-[2fr_3fr] gap-10 items-stretch">
          {/* Standalone image — tablet/desktop only */}
          <div className="hidden md:block">
            <ImageWithFallback src={imgKunoichi} alt="Contact illustration" className="w-full h-full object-cover object-top rounded-none" />
          </div>
          <div
            className="rounded-3xl p-6 md:p-8 flex flex-col relative overflow-hidden min-h-[28rem]"
            style={{ background: C.surface, boxShadow: SH2 }}
          >
            {/* Mobile: form background image + contrast overlay */}
            <div className="absolute inset-0 md:hidden pointer-events-none" aria-hidden>
              <ImageWithFallback src={imgKunoichi} alt="" className="w-full h-full object-cover object-top" />
              <div
                className="absolute inset-0"
                style={{ background: isLight ? "rgba(255,251,254,0.78)" : "rgba(29,27,32,0.72)" }}
              />
            </div>
            <div className="relative z-10 flex flex-col flex-1">{formInner}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ContactPage;
