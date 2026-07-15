import { useState, useEffect, createContext, useContext } from "react";

export type Page = "home" | "about" | "resources" | "teamwork" | "contact" | "login" | "signup" | "oauth-callback" | "messages" | "profile" | "alarms" | "admin" | "terms" | "help" | "bugs" | "status" | "patches";
export type AppSettings = { emailNotif:boolean; pushNotif:boolean; twoFA:boolean; publicProfile:boolean };
// ── MD3 Color tokens ─────────────────────────────────────────────────────────
const LIGHT_C = {
  profileName: "rgb(231,224,236)",
  primary: "#6750A4",
  primaryCont: "#EADDFF",
  onPrimary: "#fff",
  onPrimaryCont: "#21005D",
  secondary: "#625B71",
  secondaryCont: "#E8DEF8",
  onSecondaryCont: "#1D192B",
  tertiary: "#7D5260",
  error: "#B3261E",
  bg: "#FFFBFE",
  surface: "#FFFFFF",
  surfaceVar: "#E7E0EC",
  onSurface: "#1C1B1F",
  onSurfaceVar: "#49454F",
  outline: "#79747E",
  outlineVar: "#CAC4D0",
};
const DARK_C = {
  profileName: "rgb(231,224,236)",
  /** Slightly darkened from MD3 #D0BCFF to reduce glare while staying on-brand */
  primary: "#B69DF8",
  primaryCont: "#4F378B",
  onPrimary: "#2F1A5E",
  onPrimaryCont: "#EADDFF",
  secondary: "#CCC2DC",
  secondaryCont: "#4A4458",
  onSecondaryCont: "#E8DEF8",
  tertiary: "#EFB8C8",
  error: "#F2B8B5",
  bg: "#141218",
  surface: "#1D1B20",
  surfaceVar: "#211F26",
  onSurface: "#E6E0E9",
  onSurfaceVar: "#CAC4D0",
  outline: "#938F99",
  outlineVar: "#49454F",
};
/** Consistent red badge background for unread counts in light and dark mode */
const BADGE_BG = "#B3261E";
export type ColorTheme = typeof LIGHT_C;
const ThemeCtx = createContext<ColorTheme>(LIGHT_C);
const useC = () => useContext(ThemeCtx);
function useWide(px: number) {
  const [wide, setWide] = useState(() => typeof window !== "undefined" ? window.innerWidth > px : true);
  useEffect(() => {
    const h = () => setWide(window.innerWidth > px);
    window.addEventListener("resize", h);
    return () => window.removeEventListener("resize", h);
  }, [px]);
  return wide;
}

const SH1 = "0 1px 2px rgba(0,0,0,.08),0 1px 3px 1px rgba(0,0,0,.06)";
const SH2 = "0 1px 2px rgba(0,0,0,.1),0 2px 6px 2px rgba(0,0,0,.09)";
const SH3 = "0 4px 8px 3px rgba(0,0,0,.10),0 1px 3px rgba(0,0,0,.12)";

const COUNTRIES = ["Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cabo Verde","Cambodia","Cameroon","Canada","Central African Republic","Chad","Chile","China","Colombia","Comoros","Congo","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Timor-Leste","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe"];

// ── Notifications ─────────────────────────────────────────────────────────────
const ADMIN_NOTIFICATIONS = [
  { id:1, title:"Maintenance Window", body:"Scheduled maintenance on July 12 from 2AM–4AM UTC. Log off to avoid interruption.", time:"1h ago", read:false, page:"alarms" as const },
  { id:2, title:"New Season Launch", body:"Season 4 — Shadow Realm begins July 15. New raids, weapons, and clan rankings.", time:"3h ago", read:false, page:"alarms" as const },
  { id:3, title:"Guild War Results", body:"Dragon Sanctum Raiders claimed first place in last week's territory war.", time:"1d ago", read:true, page:"alarms" as const },
];

// ── Country → flag emoji + cities ─────────────────────────────────────────────
import { COUNTRY_ISO as FULL_COUNTRY_ISO } from "./countryIso";

// Re-export full ISO map
const COUNTRY_ISO: Record<string,string> = FULL_COUNTRY_ISO;
function countryFlag(name: string): string {
  const code = COUNTRY_ISO[name];
  if (!code || code.length !== 2) return "🌐";
  return String.fromCodePoint(...code.split("").map(c => 0x1F1E6 + c.charCodeAt(0) - 65));
}

const COUNTRY_CITIES: Record<string, string[]> = {
  "United States":["New York","Los Angeles","Chicago","Houston","Phoenix","Philadelphia","San Antonio","San Diego","Dallas","San Jose"],
  "Japan":["Tokyo","Osaka","Yokohama","Nagoya","Sapporo","Fukuoka","Kobe","Kyoto","Kawasaki","Saitama"],
  "United Kingdom":["London","Birmingham","Manchester","Glasgow","Liverpool","Edinburgh","Leeds","Bristol","Sheffield","Cardiff"],
  "Germany":["Berlin","Hamburg","Munich","Cologne","Frankfurt","Stuttgart","Düsseldorf","Leipzig","Dortmund","Essen"],
  "France":["Paris","Marseille","Lyon","Toulouse","Nice","Nantes","Strasbourg","Montpellier","Bordeaux","Lille"],
  "China":["Beijing","Shanghai","Guangzhou","Shenzhen","Chengdu","Chongqing","Tianjin","Wuhan","Hangzhou","Xian"],
  "India":["Mumbai","Delhi","Bangalore","Hyderabad","Ahmedabad","Chennai","Kolkata","Pune","Jaipur","Lucknow"],
  "South Korea":["Seoul","Busan","Incheon","Daegu","Daejeon","Gwangju","Suwon","Ulsan","Changwon","Seongnam"],
  "Brazil":["São Paulo","Rio de Janeiro","Brasília","Salvador","Fortaleza","Belo Horizonte","Manaus","Curitiba","Recife","Porto Alegre"],
  "Russia":["Moscow","Saint Petersburg","Novosibirsk","Yekaterinburg","Nizhny Novgorod","Kazan","Chelyabinsk","Samara","Ufa","Rostov-on-Don"],
  "Canada":["Toronto","Montreal","Calgary","Ottawa","Edmonton","Mississauga","Winnipeg","Vancouver","Brampton","Hamilton"],
  "Australia":["Sydney","Melbourne","Brisbane","Perth","Adelaide","Gold Coast","Newcastle","Canberra","Sunshine Coast","Wollongong"],
  "Italy":["Rome","Milan","Naples","Turin","Palermo","Genoa","Bologna","Florence","Bari","Catania"],
  "Spain":["Madrid","Barcelona","Valencia","Seville","Zaragoza","Málaga","Murcia","Palma","Las Palmas","Bilbao"],
  "Mexico":["Mexico City","Guadalajara","Monterrey","Puebla","Tijuana","León","Juárez","Zapopan","Mérida","Aguascalientes"],
  "Turkey":["Istanbul","Ankara","Izmir","Bursa","Adana","Gaziantep","Konya","Antalya","Mersin","Diyarbakır"],
  "Indonesia":["Jakarta","Surabaya","Bandung","Medan","Bekasi","Tangerang","Depok","Semarang","Palembang","Makassar"],
  "Netherlands":["Amsterdam","Rotterdam","The Hague","Utrecht","Eindhoven","Tilburg","Groningen","Almere","Breda","Nijmegen"],
  "Poland":["Warsaw","Kraków","Łódź","Wrocław","Poznań","Gdańsk","Szczecin","Bydgoszcz","Lublin","Katowice"],
  "Saudi Arabia":["Riyadh","Jeddah","Mecca","Medina","Dammam","Taif","Tabuk","Khobar","Abha","Najran"],
};
function citiesFor(country: string): string[] {
  return COUNTRY_CITIES[country] ?? ["Capital City","Metro City","Port City","Mountain Town","Coastal Town"];
}
const MSGS_DATA_INIT: Contact[] = [];
const AVATAR_COLORS = ["#6750A4","#B3261E","#7D5260","#386A20","#006688","#625B71","#4A4458"];
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];

function ChatAvatar({ name, avatarUrl, size = 40, channel = false, className = "" }: {
  name: string; avatarUrl?: string | null; size?: number; channel?: boolean; className?: string;
}) {
  const style = { width: size, height: size, background: avatarColor(name), fontFamily: "Roboto" as const };
  if (channel) {
    return (
      <div className={`flex items-center justify-center text-white font-bold shrink-0 rounded-xl ${className}`} style={{ ...style, fontSize: size * 0.4 }}>
        #
      </div>
    );
  }
  if (avatarUrl) {
    return (
      <div className={`relative shrink-0 ${className}`} style={{ width: size, height: size }}>
        <div className="absolute inset-0 flex items-center justify-center text-white font-medium rounded-full" style={{ ...style, fontSize: size * 0.38 }}>
          {name[0]?.toUpperCase() || "?"}
        </div>
        <img
          src={avatarUrl}
          alt={name}
          className="absolute inset-0 object-cover rounded-full"
          style={{ width: size, height: size }}
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center text-white font-medium shrink-0 rounded-full ${className}`} style={{ ...style, fontSize: size * 0.38 }}>
      {name[0]?.toUpperCase() || "?"}
    </div>
  );
}
// ── Reusable MD3 components ──────────────────────────────────────────────────
function FilledBtn({ children, onClick, cls="" }: { children:React.ReactNode; onClick?:()=>void; cls?:string }) {
  const C = useC();
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium text-white transition-all hover:shadow-md active:scale-95 ${cls}`}
      style={{ background:C.primary, fontFamily:"Roboto" }}>{children}</button>
  );
}
function OutlinedBtn({ children, onClick, cls="" }: { children:React.ReactNode; onClick?:()=>void; cls?:string }) {
  const C = useC();
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium border transition-all hover:bg-[#6750A4]/8 active:scale-95 ${cls}`}
      style={{ borderColor:C.outline, color:C.primary, fontFamily:"Roboto" }}>{children}</button>
  );
}
function TonalBtn({ children, onClick, cls="" }: { children:React.ReactNode; onClick?:()=>void; cls?:string }) {
  const C = useC();
  return (
    <button onClick={onClick} className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-sm font-medium transition-all hover:shadow-md active:scale-95 ${cls}`}
      style={{ background:C.secondaryCont, color:C.onSecondaryCont, fontFamily:"Roboto" }}>{children}</button>
  );
}

function Field({ label, type="text", value, onChange, placeholder="", rows, suffix, cls="", bg }: {
  label:string; type?:string; value?:string; onChange?:(v:string)=>void; placeholder?:string; rows?:number; suffix?:React.ReactNode; cls?:string; bg?: string;
}) {
  const C = useC();
  const inputBg = bg ?? C.surface;
  return (
    <div className={`relative mt-1 ${cls}`}>
      {rows ? (
        <textarea rows={rows} placeholder={placeholder} value={value}
          className="w-full h-full px-4 pt-4 pb-2 rounded-[4px] border text-sm focus:outline-none resize-none"
          style={{ borderColor:C.outline, color:C.onSurface, background:inputBg, fontFamily:"Roboto" }}
          onChange={e => onChange?.(e.target.value)} />
      ) : (
        <div className="relative">
          <input type={type} placeholder={placeholder} value={value}
            className="w-full px-4 py-3.5 rounded-[4px] border text-sm focus:outline-none"
            style={{ borderColor:C.outline, color:C.onSurface, background:inputBg, fontFamily:"Roboto" }}
            onChange={e => onChange?.(e.target.value)} />
          {suffix && <div className="absolute right-3 top-1/2 -translate-y-1/2">{suffix}</div>}
        </div>
      )}
      <span className="absolute left-3 -top-2 px-1 text-xs" style={{ color:C.primary, background:C.surface, fontFamily:"Roboto" }}>{label}</span>
    </div>
  );
}

function Chip({ label, color, filled=false }: { label:string; color?:string; filled?:boolean }) {
  const C = useC();
  const clr = color ?? C.primary;
  return (
    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border"
      style={{ borderColor:filled?clr:C.outlineVar, color:filled?"white":clr, background:filled?clr:"transparent", fontFamily:"Roboto" }}>
      {label}
    </span>
  );
}

// ── Flag image helper ─────────────────────────────────────────────────────────
function FlagImg({ country, size=20 }: { country:string; size?:number }) {
  const iso = (COUNTRY_ISO[country] || "").toLowerCase();
  if (!iso) return <span className="text-base">{countryFlag(country)}</span>;
  return (
    <img
      src={`https://flagcdn.com/w${Math.max(size, 20)}/${iso}.png`}
      alt={`${country} flag`}
      width={size}
      height={Math.round(size * 0.67)}
      className="rounded-sm object-cover shrink-0 inline-block"
    />
  );
}

export type Contact = {
  id: number;
  name: string;
  msg: string;
  time: string;
  unread: number;
  online: boolean;
  bio: string;
  type: "channel" | "dm";
  avatarUrl?: string | null;
  status?: string;
  muted?: boolean;
  otherUserId?: number;
  village?: string;
  clan?: string;
  level?: number;
  rank?: string;
  memberSince?: string;
  isTeamMember?: boolean;
  country?: string;
  city?: string | null;
};

export {
  LIGHT_C, DARK_C, ThemeCtx, useC, useWide,
  SH1, SH2, SH3, BADGE_BG,
  COUNTRIES, COUNTRY_ISO, COUNTRY_CITIES, countryFlag, citiesFor,
  ADMIN_NOTIFICATIONS, MSGS_DATA_INIT, AVATAR_COLORS, avatarColor, ChatAvatar,
  FilledBtn, OutlinedBtn, TonalBtn, Field, Chip, FlagImg,
};
