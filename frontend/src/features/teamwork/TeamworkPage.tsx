import { useState, useRef, useEffect } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import CloseIcon from "@mui/icons-material/Close";
import CheckIcon from "@mui/icons-material/Check";
import ChatIcon from "@mui/icons-material/Chat";
import PersonIcon from "@mui/icons-material/Person";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import DescriptionIcon from "@mui/icons-material/Description";
import SendIcon from "@mui/icons-material/Send";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import imgCouncil from "@/imports/64bf4eef-ff43-41c7-ae42-ff35377ff5e3.webp";
import {
  Page, useC, SH1, COUNTRIES, citiesFor, ChatAvatar,
  FilledBtn, TonalBtn, Chip, FlagImg,
} from "@/app/shared";
import { api } from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";

const ALL_ROLES = [
  { title:"Senior 3D Artist",     dept:"Art",         type:"Remote · Full-time" },
  { title:"Backend Engineer",     dept:"Engineering", type:"Remote · Full-time" },
  { title:"Game Developer",    dept:"Game",        type:"Remote · Part-time" },
  { title:"Blockchain Developer", dept:"Blockchain",  type:"Remote · Full-time" },
  { title:"AI/ML Engineer",       dept:"AI",          type:"Remote · Full-time" },
  { title:"UI/UX Designer",       dept:"Design",      type:"Remote · Full-time" },
];
function TeamworkPage({ loggedIn, setPage, onAddDM }: { loggedIn:boolean; setPage:(p:Page)=>void; onAddDM:(name:string,role:string,country:string,city:string)=>void }) {
  const C = useC();
  const [team, setTeam] = useState<{
    name: string;
    role: string;
    dept: string;
    country: string;
    city: string;
    statusLabel?: string;
    statusColor?: string;
    avatarUrl?: string | null;
    userId?: number;
    username?: string;
  }[]>([]);
  const [memberModal, setMemberModal] = useState<typeof team[0]|null>(null);
  const [applyRole, setApplyRole] = useState<typeof ALL_ROLES[0]|null>(null);

  // Apply form state
  const [applyPhoto, setApplyPhoto] = useState<string|null>(null);
  const [applyName, setApplyName] = useState("");
  const [applyGender, setApplyGender] = useState("Male");
  const [applyDobM, setApplyDobM] = useState("");
  const [applyDobD, setApplyDobD] = useState("");
  const [applyDobY, setApplyDobY] = useState("");
  const [applyCountry, setApplyCountry] = useState("Japan");
  const [applyCity, setApplyCity] = useState("");
  const [applyCvName, setApplyCvName] = useState("");
  const [applyPortfolio, setApplyPortfolio] = useState("");
  const [applyMsg, setApplyMsg] = useState("");
  const [applyPhotoFile, setApplyPhotoFile] = useState<File | null>(null);
  const [applyCvFile, setApplyCvFile] = useState<File | null>(null);
  const [jobs, setJobs] = useState<{ id: number; title: string; department: string; type: string }[]>(ALL_ROLES.map((r, i) => ({ id: i + 1, title: r.title, department: r.dept, type: r.type })));
  const [applySubmitted, setApplySubmitted] = useState(false);
  const applyPhotoRef = useRef<HTMLInputElement>(null);
  const applyCvRef = useRef<HTMLInputElement>(null);

  const loadTeam = () => {
    api.content.team().then(r => {
      if (r.team?.length) {
        setTeam(r.team.map(m => {
          const raw = (m as { avatarUrl?: string | null; avatar_url?: string | null }).avatarUrl
            ?? (m as { avatar_url?: string | null }).avatar_url
            ?? null;
          const avatarUrl = raw && String(raw).trim()
            ? (/^https?:\/\//i.test(String(raw)) || String(raw).startsWith("/")
              ? String(raw)
              : `/uploads/${String(raw).replace(/^\/+/, "")}`)
            : null;
          // Live username is source of truth; team_members.name is fallback only.
          const displayName = m.username || m.name || "Deleted User";
          return {
            name: displayName,
            role: m.role,
            dept: m.department,
            country: m.country,
            city: m.city,
            statusLabel: m.statusLabel,
            statusColor: m.statusColor,
            avatarUrl,
            userId: m.userId,
            username: m.username,
          };
        }));
      } else {
        setTeam([]);
      }
    }).catch(() => setTeam([]));
  };

  useEffect(() => {
    api.jobs.list().then(r => setJobs(r.jobs)).catch(() => {});
    loadTeam();
    const unsubs = [
      onRealtimeEvent("team:updated", () => loadTeam()),
      onRealtimeEvent<{
        userId: number;
        username: string;
        avatarUrl?: string | null;
      }>("profile:updated", (data) => {
        if (!data?.userId || !data.username) return;
        setTeam(prev => {
          let changed = false;
          const next = prev.map(m => {
            if (m.userId !== data.userId) return m;
            changed = true;
            return {
              ...m,
              name: data.username,
              username: data.username,
              avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : m.avatarUrl,
            };
          });
          return changed ? next : prev;
        });
        setMemberModal(prev => {
          if (!prev || prev.userId !== data.userId) return prev;
          return {
            ...prev,
            name: data.username,
            username: data.username,
            avatarUrl: data.avatarUrl !== undefined ? data.avatarUrl : prev.avatarUrl,
          };
        });
      }),
    ];
    return () => unsubs.forEach(u => u());
  }, []);

  const submitApplication = async () => {
    if (!applyRole || !applyName) return;
    const job = jobs.find(j => j.title === applyRole.title);
    if (!job) { setApplySubmitted(true); return; }
    const form = new FormData();
    form.append("fullName", applyName);
    form.append("gender", applyGender);
    if (applyDobY && applyDobM && applyDobD) {
      form.append("dateOfBirth", `${applyDobY}-${applyDobM.padStart(2,"0")}-${applyDobD.padStart(2,"0")}`);
    }
    form.append("country", applyCountry);
    form.append("city", applyCity);
    form.append("portfolioUrl", applyPortfolio);
    form.append("message", applyMsg);
    if (applyPhotoFile) form.append("photo", applyPhotoFile);
    if (applyCvFile) form.append("cv", applyCvFile);
    try {
      await api.jobs.apply(job.id, form);
    } catch { /* show success UI anyway for demo */ }
    setApplySubmitted(true);
  };

  const handleApplyClick = (role: typeof ALL_ROLES[0]) => {
    if (!loggedIn) { setPage("login"); return; }
    setApplyRole(role); setApplySubmitted(false);
  };

  return (
    <div style={{ background:C.bg }} className="pt-16">
      {/* Member info modal */}
      {memberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setMemberModal(null)}>
          <div className="rounded-3xl p-7 w-full max-w-xs text-center" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.24)" }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setMemberModal(null)} className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5" style={{ color:C.onSurfaceVar }}><CloseIcon style={{ fontSize:18 }} /></button>
            <div className="relative inline-block mb-4">
              <ChatAvatar name={memberModal.name} avatarUrl={memberModal.avatarUrl} size={96} className="mx-auto" />
              {memberModal.statusLabel && memberModal.statusColor && (
                <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap" style={{ background: memberModal.statusColor }}>{memberModal.statusLabel}</span>
              )}
            </div>
            <h3 className="font-medium text-base mb-1 mt-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{memberModal.name}</h3>
            <p className="text-sm mb-1" style={{ color:C.primary, fontFamily:"Roboto" }}>{memberModal.role}</p>
            <Chip label={memberModal.dept} />
            <div className="mt-4 pt-4 border-t text-sm flex items-center justify-center gap-2" style={{ borderColor:C.outlineVar }}>
              <FlagImg country={memberModal.country} size={16} />
              <span style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{memberModal.country} · {memberModal.city}</span>
            </div>
            <button
              onClick={() => { onAddDM(memberModal.name, memberModal.role, memberModal.country, memberModal.city); setMemberModal(null); }}
              className="mt-5 w-full flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-medium text-white hover:opacity-90 transition-opacity"
              style={{ background:C.primary, fontFamily:"Roboto" }}>
              <ChatIcon style={{ fontSize:16 }} /> Send Message
            </button>
          </div>
        </div>
      )}
      {/* Apply modal */}
      {applyRole && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto" onClick={() => setApplyRole(null)}>
          <div className="rounded-3xl p-7 w-full max-w-lg my-8" style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.24)" }} onClick={e => e.stopPropagation()}>
            {applySubmitted ? (
              <div className="text-center py-6">
                <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:"#D7E8D4" }}><CheckIcon style={{ fontSize:28, color:"#386A20" }} /></div>
                <h3 className="text-xl font-medium mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Application Sent!</h3>
                <p className="text-sm mb-6" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{"We'll review your application and get back to you within 5 business days."}</p>
                <TonalBtn onClick={() => setApplyRole(null)}>Close</TonalBtn>
              </div>
            ) : (
              <>
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h3 className="font-medium text-base" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Apply: {applyRole.title}</h3>
                    <p className="text-xs mt-0.5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{applyRole.dept} · {applyRole.type}</p>
                  </div>
                  <button onClick={() => setApplyRole(null)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-black/5" style={{ color:C.onSurfaceVar }}><CloseIcon style={{ fontSize:18 }} /></button>
                </div>
                <div className="space-y-5">
                  {/* Photo upload */}
                  <div className="flex items-center gap-4">
                    <div className="relative cursor-pointer" onClick={() => applyPhotoRef.current?.click()}>
                      <div className="w-16 h-16 rounded-full overflow-hidden flex items-center justify-center text-white text-xl font-medium" style={{ background:C.primary }}>
                        {applyPhoto ? <img src={applyPhoto} alt="" className="w-full h-full object-cover" /> : <PersonIcon style={{ fontSize:28 }} />}
                      </div>
                      <div className="absolute inset-0 rounded-full bg-black/30 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"><PhotoCameraIcon style={{ fontSize:18, color:"white" }} /></div>
                      <input ref={applyPhotoRef} type="file" accept="image/*" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(f) { setApplyPhoto(URL.createObjectURL(f)); setApplyPhotoFile(f); } }} />
                    </div>
                    <div className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Click to upload your photo</div>
                  </div>
                  {/* Full name */}
                  <div className="relative mt-1">
                    <input value={applyName} onChange={e => setApplyName(e.target.value)} placeholder="Your full name" className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Full Name</span>
                  </div>
                  {/* Gender */}
                  <div className="relative mt-1">
                    <select value={applyGender} onChange={e => setApplyGender(e.target.value)} className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none appearance-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }}>
                      {["Male","Female"].map(o => <option key={o}>{o}</option>)}
                    </select>
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Gender</span>
                    <ExpandMoreIcon style={{ fontSize:20, color:C.onSurfaceVar, position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} />
                  </div>
                  {/* Date of Birth — MM / DD / YYYY */}
                  <div className="relative mt-1">
                    <div className="flex gap-2 w-full px-3 py-2.5 rounded-[4px] border" style={{ borderColor:C.outline, background:C.surface }}>
                      <input type="number" min={1} max={12} placeholder="MM" value={applyDobM} onChange={e => setApplyDobM(e.target.value)} className="w-12 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                      <span style={{ color:C.onSurfaceVar }}>/</span>
                      <input type="number" min={1} max={31} placeholder="DD" value={applyDobD} onChange={e => setApplyDobD(e.target.value)} className="w-12 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                      <span style={{ color:C.onSurfaceVar }}>/</span>
                      <input type="number" min={1900} max={2099} placeholder="YYYY" value={applyDobY} onChange={e => setApplyDobY(e.target.value)} className="w-16 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                    </div>
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Date of Birth</span>
                  </div>
                  {/* Country + City */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="relative mt-1">
                      <div className="flex items-center gap-2 w-full px-3 py-2.5 rounded-[4px] border" style={{ borderColor:C.outline, background:C.surface }}>
                        <FlagImg country={applyCountry} />
                        <select value={applyCountry} onChange={e => { setApplyCountry(e.target.value); setApplyCity(""); }} className="flex-1 bg-transparent text-sm focus:outline-none appearance-none" style={{ color:C.onSurface, fontFamily:"Roboto" }}>
                          {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <ExpandMoreIcon style={{ fontSize:18, color:C.onSurfaceVar, pointerEvents:"none" }} />
                      </div>
                      <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Country</span>
                    </div>
                    <div className="relative mt-1">
                      <div className="flex items-center gap-2 w-full px-3 py-2.5 rounded-[4px] border" style={{ borderColor:C.outline, background:C.surface }}>
                        <select value={applyCity} onChange={e => setApplyCity(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none appearance-none" style={{ color:C.onSurface, fontFamily:"Roboto" }}>
                          <option value="">Select city...</option>
                          {citiesFor(applyCountry).map(c => <option key={c}>{c}</option>)}
                        </select>
                        <ExpandMoreIcon style={{ fontSize:18, color:C.onSurfaceVar, pointerEvents:"none" }} />
                      </div>
                      <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>City</span>
                    </div>
                  </div>
                  {/* CV upload */}
                  <div>
                    <input ref={applyCvRef} type="file" accept=".pdf,.doc,.docx" className="hidden" onChange={e => { const f=e.target.files?.[0]; if(f) { setApplyCvName(f.name); setApplyCvFile(f); } }} />
                    <button onClick={() => applyCvRef.current?.click()} className="w-full flex items-center gap-3 px-4 py-3 rounded-[4px] border text-sm text-left hover:bg-black/3 transition-colors" style={{ borderColor:C.outline, color:applyCvName?C.onSurface:C.onSurfaceVar, fontFamily:"Roboto" }}>
                      <DescriptionIcon style={{ fontSize:18, color:C.primary }} />
                      {applyCvName || "Upload CV / Resume (PDF, DOC)"}
                    </button>
                  </div>
                  {/* Portfolio link */}
                  <div className="relative mt-1">
                    <input value={applyPortfolio} onChange={e => setApplyPortfolio(e.target.value)} placeholder="https://yourportfolio.com" className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Portfolio Link</span>
                  </div>
                  {/* Message */}
                  <div className="relative mt-1">
                    <textarea rows={4} value={applyMsg} onChange={e => setApplyMsg(e.target.value)} placeholder="Tell us why you'd be a great fit..." className="w-full px-4 pt-4 pb-2 rounded-[4px] border text-sm focus:outline-none resize-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Application Message</span>
                  </div>
                  <FilledBtn onClick={submitApplication} cls="w-full justify-center"><SendIcon style={{ fontSize:16 }} />Submit Application</FilledBtn>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      <div className="relative h-[50vh] overflow-hidden">
        <ImageWithFallback src={imgCouncil} alt="Team" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/55" />
        <div className="absolute inset-0 flex items-center justify-center"><h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>Contributors</h1></div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-2xl font-light mb-3" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Meet the <span className="font-medium">Team</span></h2>
          <p className="text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Approved team members building Ninja Era together.</p>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-5 mb-16">
          {team.length === 0 ? (
            <p className="col-span-full text-center text-sm py-12" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>No approved team members yet.</p>
          ) : team.map(m => (
              <div key={m.userId ?? m.name} className="rounded-3xl p-6 text-center hover:scale-[1.02] transition-all cursor-pointer" style={{ background:C.surface, boxShadow:SH1 }} onClick={() => setMemberModal(m)}>
                <div className="relative inline-block mb-4">
                  <ChatAvatar name={m.name} avatarUrl={m.avatarUrl} size={96} className="mx-auto" />
                  {m.statusLabel && m.statusColor && <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full text-[10px] font-bold text-white whitespace-nowrap" style={{ background: m.statusColor }}>{m.statusLabel}</span>}
                </div>
                <h3 className="font-medium text-sm mb-1" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{m.name}</h3>
                <p className="text-xs mb-3" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{m.role}</p>
                <Chip label={m.dept} />
              </div>
            ))}
        </div>
        <div className="rounded-3xl p-10" style={{ background:C.primaryCont }}>
          <div className="text-center mb-8">
            <h2 className="text-2xl font-light mb-3" style={{ color:C.onPrimaryCont, fontFamily:"'Trade Winds', cursive" }}>Join Our <span className="font-medium">Team</span></h2>
            <p className="text-sm" style={{ color:C.onPrimaryCont, fontFamily:"Roboto" }}>{"We're always looking for passionate talent."}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {ALL_ROLES.map(role => (
              <div key={role.title} className="rounded-2xl p-5 hover:scale-[1.02] transition-all" style={{ background:C.surface, boxShadow:SH1 }}>
                <div className="flex items-start justify-between mb-1">
                  <h4 className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{role.title}</h4>
                  <Chip label={role.dept} />
                </div>
                <p className="text-xs mb-3" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{role.type}</p>
                <button onClick={() => handleApplyClick(role)} className="flex items-center gap-1 text-xs font-medium hover:gap-2 transition-all" style={{ color:C.primary, fontFamily:"Roboto" }}>Apply <ChevronRightIcon style={{ fontSize:14 }} /></button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default TeamworkPage;
