import { useState, useRef, useEffect } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import CheckIcon from "@mui/icons-material/Check";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import VisibilityIcon from "@mui/icons-material/Visibility";
import VisibilityOffIcon from "@mui/icons-material/VisibilityOff";
import PhotoCameraIcon from "@mui/icons-material/PhotoCamera";
import SecurityIcon from "@mui/icons-material/Security";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import StarIcon from "@mui/icons-material/Star";
import MilitaryTechIcon from "@mui/icons-material/MilitaryTech";
import DiamondIcon from "@mui/icons-material/Diamond";
import WorkspacePremiumIcon from "@mui/icons-material/WorkspacePremium";
import ShieldIcon from "@mui/icons-material/Shield";
import WhatshotIcon from "@mui/icons-material/Whatshot";
import imgHero from "@/imports/bd24127e-135e-438e-bd57-6204d9b433ee.png";
import {
  Page, AppSettings, useC, SH1, SH3, COUNTRIES, Field, FilledBtn, OutlinedBtn, FlagImg,
} from "@/app/shared";
import { api, type ApiUser } from "@/app/api";
import { toast } from "sonner";

function ProfilePage({ setPage, isDark, setIsDark, settings, setSettings, user, setUser, userAvatar, setUserAvatar, onLogout }: {
  setPage:(p:Page)=>void; isDark:boolean; setIsDark:(v:boolean)=>void;
  settings:AppSettings; setSettings:(s:AppSettings)=>void;
  user: ApiUser | null; setUser: (u: ApiUser) => void;
  userAvatar:string|null; setUserAvatar:(v:string|null)=>void;
  onLogout: () => void;
}) {
  const C = useC();
  const [activeTab, setActiveTab] = useState("Profile");
  const [username, setUsername] = useState(user?.username || "");
  const [gender, setGender] = useState(user?.gender || "Prefer not to say");
  const [dobM, setDobM] = useState("");
  const [dobD, setDobD] = useState("");
  const [dobY, setDobY] = useState("");
  const [country, setCountry] = useState("Japan");
  const [showCurPw, setShowCurPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [showConfPw, setShowConfPw] = useState(false);
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confPw, setConfPw] = useState("");
  const [bio, setBio] = useState(user?.bio || "");
  const [stats, setStats] = useState<Record<string, number> | null>(null);
  const [activities, setActivities] = useState<{ description: string; createdAt: string }[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  const tabs = [
    { id: "Profile", label: "Profile" },
    { id: "Stats", label: "Stats" },
    { id: "Achievements", label: "Achievements", mobileLabel: "Achieve" },
    { id: "Inventory", label: "Inventory" },
    { id: "Settings", label: "Settings" },
  ] as const;
  const selStyle = { borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" };

  useEffect(() => {
    if (!user) return;
    setUsername(user.username);
    setGender(user.gender || "Prefer not to say");
    setCountry(user.country || "Japan");
    setBio(user.bio || "");
    if (user.dateOfBirth) {
      const [y, m, d] = user.dateOfBirth.split("-");
      setDobY(y || ""); setDobM(m || ""); setDobD(d || "");
    }
  }, [user]);

  useEffect(() => {
    api.users.stats().then(r => { setStats(r.stats); setActivities(r.activities); }).catch(() => {});
  }, []);

  // Auto-detect country from IP only when country not set
  useEffect(() => {
    if (user?.country) return;
    fetch("https://ipapi.co/json/").then(r => r.json()).then(d => {
      if (d.country_name && COUNTRIES.includes(d.country_name)) setCountry(d.country_name);
    }).catch(() => {});
  }, [user?.country]);

  const toggle = (key: keyof AppSettings, val: boolean) => {
    const next = { ...settings, [key]: val };
    setSettings(next);
    api.users.updateSettings({ [key]: val }).catch(() => {});
    if (key === "pushNotif" && val) {
      if ("Notification" in window) Notification.requestPermission();
    }
  };

  const saveProfile = async () => {
    const dob = dobY && dobM && dobD ? `${dobY}-${dobM.padStart(2,"0")}-${dobD.padStart(2,"0")}` : undefined;
    try {
      const { user: updated } = await api.users.update({ username, gender, country, dateOfBirth: dob, bio });
      setUser(updated);
      toast.success("Profile saved");
    } catch {
      toast.error("Failed to save profile");
    }
  };

  const updatePassword = async () => {
    if (!curPw || !newPw) return;
    if (newPw !== confPw) { toast.error("Passwords do not match"); return; }
    try {
      await api.users.changePassword(curPw, newPw);
      toast.success("Password updated");
      setCurPw(""); setNewPw(""); setConfPw("");
    } catch {
      toast.error("Failed to update password");
    }
  };

  const switchDefs = [
    { key:"emailNotif" as const, t:"Email Notifications", d:"Show alerts when receiving messages or notifications" },
    { key:"pushNotif"  as const, t:"Push Notifications",  d:"System-level alerts when browsing other sites" },
    { key:"twoFA"      as const, t:"Two-Factor Auth",     d:"Extra login security via authenticator app" },
    { key:"publicProfile" as const, t:"Public Profile",   d:"Show gender, birth date & nationality to others" },
  ];
  return (
    <div style={{ background:C.bg }} className="min-h-screen pt-16">
      <div className="relative h-60 overflow-hidden">
        <ImageWithFallback src={imgHero} alt="banner" className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/40" />
      </div>
      <div className="max-w-5xl mx-auto px-6 -mt-14 relative z-10">
        <div className="flex items-end gap-5 mb-6">
          <div className="relative group cursor-pointer" onClick={() => fileRef.current?.click()}>
            <div className="w-24 h-24 rounded-full border-4 border-white overflow-hidden flex items-center justify-center text-white text-3xl font-medium" style={{ background:C.primary, fontFamily:"Roboto", boxShadow:SH3 }}>
              {userAvatar ? <img src={userAvatar} alt="avatar" className="w-full h-full object-cover" /> : (user?.username?.[0]?.toUpperCase() || "?")}
            </div>
            <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><PhotoCameraIcon style={{ fontSize:24, color:"white" }} /></div>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const { avatarUrl } = await api.users.uploadAvatar(f);
                setUserAvatar(avatarUrl);
                if (user) setUser({ ...user, avatarUrl });
              } catch {
                setUserAvatar(URL.createObjectURL(f));
              }
            }} />
          </div>
          <div className="mb-3">
            <h1 className="text-2xl font-medium" style={{ fontFamily:"'Trade Winds', cursive", color:C.profileName }}>{user?.username || "Shinobi"}</h1>
            <p className="text-sm font-medium mt-0.5" style={{ color:C.primary, fontFamily:"Roboto" }}>
              {user?.village || "Leaf Village"} · {user?.clan || "Dragon Clan"} · Level {user?.level ?? 1}
              {user?.isTeamMember ? " · Team Member" : user?.isAdmin ? " · Admin" : " · Member"}
            </p>
          </div>
          <div className="ml-auto mb-3"></div>
        </div>
        <div className="flex w-full border-b mb-8 overflow-hidden md:overflow-visible" style={{ borderColor:C.outlineVar }}>
          {tabs.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className="flex-1 md:flex-none min-w-0 px-2 md:px-5 py-3 text-sm font-medium text-center md:text-left whitespace-nowrap transition-all border-b-2"
              style={{ borderColor:activeTab===t.id?C.primary:"transparent", color:activeTab===t.id?C.primary:C.onSurfaceVar, fontFamily:"Roboto" }}
              aria-selected={activeTab===t.id}
              role="tab"
            >
              {"mobileLabel" in t && t.mobileLabel ? (
                <>
                  <span className="md:hidden">{t.mobileLabel}</span>
                  <span className="hidden md:inline">{t.label}</span>
                </>
              ) : t.label}
            </button>
          ))}
        </div>
        {activeTab==="Profile" && (
          <div className="space-y-6 pb-16">
            <div className="grid md:grid-cols-2 gap-6">
              {/* Personal Info */}
              <div className="rounded-3xl p-6" style={{ background:C.surface, boxShadow:SH1 }}>
                <h2 className="text-lg font-medium mb-5" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Personal Info</h2>
                <div className="space-y-5">
                  {/* Email — disabled, same style as other fields */}
                  <div className="relative mt-1">
                    <input disabled value={user?.email || "ninja@example.com"} className="w-full px-4 py-3.5 rounded-[4px] border text-sm cursor-not-allowed" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto", opacity:1 }} />
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Email</span>
                  </div>
                  <Field label="Username" value={username} onChange={setUsername} />
                  {/* Gender */}
                  <div className="relative mt-1">
                    <select value={gender} onChange={e => setGender(e.target.value)} className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none appearance-none" style={selStyle}>
                      {["Male","Female","Non-binary","Prefer not to say"].map(o => <option key={o}>{o}</option>)}
                    </select>
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Gender</span>
                    <ExpandMoreIcon style={{ fontSize:20, color:C.onSurfaceVar, position:"absolute", right:12, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }} />
                  </div>
                  {/* Date of Birth — MM / DD / YYYY */}
                  <div className="relative mt-1">
                    <div className="flex gap-2 items-center w-full px-3 py-2.5 rounded-[4px] border" style={{ borderColor:C.outline, background:C.surface }}>
                      <input type="number" min={1} max={12} placeholder="MM" value={dobM} onChange={e => setDobM(e.target.value)} className="w-12 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                      <span style={{ color:C.onSurfaceVar }}>/</span>
                      <input type="number" min={1} max={31} placeholder="DD" value={dobD} onChange={e => setDobD(e.target.value)} className="w-12 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                      <span style={{ color:C.onSurfaceVar }}>/</span>
                      <input type="number" min={1900} max={2099} placeholder="YYYY" value={dobY} onChange={e => setDobY(e.target.value)} className="w-16 bg-transparent text-sm text-center focus:outline-none" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }} />
                    </div>
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Date of Birth</span>
                  </div>
                  {/* Country with flag image */}
                  <div className="relative mt-1">
                    <div className="flex items-center gap-2 w-full px-3 py-2.5 rounded-[4px] border" style={{ borderColor:C.outline, background:C.surface }}>
                      <FlagImg country={country} />
                      <select value={country} onChange={e => setCountry(e.target.value)} className="flex-1 bg-transparent text-sm focus:outline-none appearance-none" style={{ color:C.onSurface, fontFamily:"Roboto" }}>
                        {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                      </select>
                      <ExpandMoreIcon style={{ fontSize:18, color:C.onSurfaceVar, pointerEvents:"none" }} />
                    </div>
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Country</span>
                  </div>
                  {/* Bio */}
                  <div className="relative mt-1">
                    <textarea
                      rows={3}
                      value={bio}
                      onChange={e => setBio(e.target.value)}
                      className="w-full px-4 pt-4 pb-2 rounded-[4px] border text-sm focus:outline-none resize-none"
                      style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }}
                    />
                    <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Bio</span>
                  </div>
                </div>
                <div className="flex gap-3 mt-6">
                  <FilledBtn onClick={saveProfile} cls="flex-1 justify-center"><CheckIcon style={{ fontSize:16 }} />Save Changes</FilledBtn>
                  <OutlinedBtn cls="flex-1 justify-center">Cancel</OutlinedBtn>
                </div>
              </div>
              {/* Stats */}
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  {[
                    [String(user?.level ?? 1), "Level"],
                    [String(stats?.missions_complete ?? 0), "Missions"],
                    [`${stats?.playtime_hours ?? 0}h`, "Playtime"],
                    [`#${stats?.global_rank ?? 0}`, "Global Rank"],
                  ].map(([v, l]) => (
                    <div key={l} className="rounded-3xl p-5 text-center" style={{ background:C.surface, boxShadow:SH1 }}>
                      <div className="text-2xl font-medium mb-0.5" style={{ color:C.primary, fontFamily:"Roboto" }}>{v}</div>
                      <div className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{l}</div>
                    </div>
                  ))}
                </div>
                {/* Recent Activity */}
                <div className="rounded-3xl p-5" style={{ background:C.surface, boxShadow:SH1 }}>
                  <h3 className="font-medium text-sm mb-4" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Recent Activity</h3>
                  <div className="space-y-3">
                    {activities.length === 0 ? (
                      <p className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>No recent activity yet.</p>
                    ) : activities.map((a, i) => (
                      <div key={`${a.description}-${i}`} className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background:`${C.primary}18` }}>
                          <StarIcon style={{ fontSize:18, color:C.primary }} />
                        </div>
                        <div className="flex-1">
                          <p className="text-xs font-medium" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{a.description}</p>
                          <p className="text-[10px]" style={{ color:C.onSurfaceVar, fontFamily:"Roboto Mono,monospace" }}>
                            {a.createdAt ? new Date(a.createdAt).toLocaleString() : ""}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>{/* closes space-y-5 right column */}
            </div>{/* closes grid md:grid-cols-2 */}
            {/* Change Password */}
            <div className="rounded-3xl p-6" style={{ background:C.surface, boxShadow:SH1 }}>
              <h2 className="text-lg font-medium mb-5" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Change Password</h2>
              <div className="grid md:grid-cols-3 gap-5">
                <div className="relative mt-1">
                  <input type={showCurPw?"text":"password"} value={curPw} onChange={e => setCurPw(e.target.value)} placeholder="Current password" className="w-full px-4 py-3.5 pr-12 rounded-[4px] border text-sm focus:outline-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                  <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Current Password</span>
                  <button onClick={() => setShowCurPw(!showCurPw)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:C.onSurfaceVar }}>{showCurPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>
                </div>
                <div className="relative mt-1">
                  <input type={showNewPw?"text":"password"} value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="New password" className="w-full px-4 py-3.5 pr-12 rounded-[4px] border text-sm focus:outline-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                  <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>New Password</span>
                  <button onClick={() => setShowNewPw(!showNewPw)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:C.onSurfaceVar }}>{showNewPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>
                </div>
                <div className="relative mt-1">
                  <input type={showConfPw?"text":"password"} value={confPw} onChange={e => setConfPw(e.target.value)} placeholder="Confirm new password" className="w-full px-4 py-3.5 pr-12 rounded-[4px] border text-sm focus:outline-none" style={{ borderColor:C.outline, color:C.onSurface, background:C.surface, fontFamily:"Roboto" }} />
                  <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>Confirm Password</span>
                  <button onClick={() => setShowConfPw(!showConfPw)} className="absolute right-3 top-1/2 -translate-y-1/2" style={{ color:C.onSurfaceVar }}>{showConfPw?<VisibilityOffIcon style={{ fontSize:20 }} />:<VisibilityIcon style={{ fontSize:20 }} />}</button>
                </div>
              </div>
              <div className="flex gap-3 mt-6">
                <FilledBtn onClick={updatePassword} cls="justify-center"><SecurityIcon style={{ fontSize:16 }} />Update Password</FilledBtn>
                <OutlinedBtn cls="justify-center">Cancel</OutlinedBtn>
              </div>
            </div>
          </div>
        )}
        {activeTab==="Stats" && (
          <div className="pb-16">
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              {[
                [String(stats?.missions_complete ?? 0), "Missions Complete"],
                [String(stats?.pvp_wins ?? 0), "PvP Wins"],
                [`${stats?.playtime_hours ?? 0}h`, "Playtime"],
                [String(stats?.legendary_items ?? 0), "Legendary Items"],
              ].map(([v,l]) => (
                <div key={l} className="rounded-3xl p-5 text-center" style={{ background:C.surface, boxShadow:SH1 }}>
                  <div className="text-3xl font-medium mb-1" style={{ color:C.primary, fontFamily:"Roboto" }}>{v}</div>
                  <div className="text-sm" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{l}</div>
                </div>
              ))}
            </div>
            <div className="rounded-3xl p-6" style={{ background:C.surface, boxShadow:SH1 }}>
              <h3 className="font-medium mb-6" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Skill Proficiency</h3>
              <div className="space-y-5">
                {([
                  ["Ninjutsu", stats?.ninjutsu ?? 0],
                  ["Taijutsu", stats?.taijutsu ?? 0],
                  ["Genjutsu", stats?.genjutsu ?? 0],
                  ["Senjutsu", stats?.senjutsu ?? 0],
                  ["Kenjutsu", stats?.kenjutsu ?? 0],
                ] as [string, number][]).map(([s,v]) => (
                  <div key={s}>
                    <div className="flex justify-between text-sm mb-2"><span style={{ color:C.onSurface, fontFamily:"Roboto" }}>{s}</span><span style={{ color:C.onSurfaceVar, fontFamily:"Roboto Mono,monospace" }}>{v}/100</span></div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background:C.surfaceVar }}><div className="h-full rounded-full" style={{ width:`${v}%`, background:C.primary }} /></div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
        {(activeTab==="Achievements"||activeTab==="Inventory") && (
          <div className="pb-16">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {[...Array(8)].map((_,i) => {
                const icons = [EmojiEventsIcon,StarIcon,MilitaryTechIcon,DiamondIcon,WorkspacePremiumIcon,ShieldIcon,SecurityIcon,WhatshotIcon];
                const Icon = icons[i%icons.length];
                const names = activeTab==="Achievements"
                  ? ["First Blood","Dragon Slayer","Guild Master","Legendary","Speed Demon","Pacifist","The Unbroken","Ascendant"]
                  : ["Iron Katana","Shadow Mask","Fire Robes","Wind Boots","Jade Ring","Soul Seal","Dark Armor","Void Blade"];
                return (
                  <div key={i} className="rounded-3xl p-5 text-center hover:scale-[1.03] transition-all cursor-pointer" style={{ background:C.surface, boxShadow:SH1 }}>
                    <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background:C.primaryCont }}><Icon style={{ fontSize:22, color:C.primary }} /></div>
                    <p className="font-medium text-xs" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{names[i]}</p>
                    <p className="text-[10px] mt-0.5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Unlocked</p>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {activeTab==="Settings" && (
          <div className="max-w-xl pb-16 space-y-3">
            {/* Dark Mode — uses isDark/setIsDark directly */}
            <div className="flex items-center justify-between p-4 rounded-2xl" style={{ background:C.surface, boxShadow:SH1 }}>
              <div>
                <p className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>Dark Mode</p>
                <p className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Switch the site to dark theme</p>
              </div>
              <button onClick={() => setIsDark(!isDark)} className="w-12 h-6 rounded-full relative transition-colors" style={{ background:isDark?C.primary:C.outline }}>
                <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 shadow-sm transition-all" style={{ left:isDark?"calc(100% - 22px)":"2px" }} />
              </button>
            </div>
            {switchDefs.map(s => {
              const on = settings[s.key];
              return (
                <div key={s.key} className="flex items-center justify-between p-4 rounded-2xl" style={{ background:C.surface, boxShadow:SH1 }}>
                  <div>
                    <p className="font-medium text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{s.t}</p>
                    <p className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{s.d}</p>
                  </div>
                  <button onClick={() => toggle(s.key, !on)} className="w-12 h-6 rounded-full relative transition-colors" style={{ background:on?C.primary:C.outline }}>
                    <div className="w-5 h-5 rounded-full bg-white absolute top-0.5 shadow-sm transition-all" style={{ left:on?"calc(100% - 22px)":"2px" }} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default ProfilePage;
