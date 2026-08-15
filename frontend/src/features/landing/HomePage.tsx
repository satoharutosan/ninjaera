import { useState, useEffect } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import PublicIcon from "@mui/icons-material/Public";
import SportsEsportsIcon from "@mui/icons-material/SportsEsports";
import GavelIcon from "@mui/icons-material/Gavel";
import StorefrontIcon from "@mui/icons-material/Storefront";
import ShieldIcon from "@mui/icons-material/Shield";
import EmojiEventsIcon from "@mui/icons-material/EmojiEvents";
import MapIcon from "@mui/icons-material/Map";
import PeopleIcon from "@mui/icons-material/People";
import AutoStoriesIcon from "@mui/icons-material/AutoStories";
import SecurityIcon from "@mui/icons-material/Security";
import MilitaryTechIcon from "@mui/icons-material/MilitaryTech";
import PersonIcon from "@mui/icons-material/Person";
import FiberManualRecordIcon from "@mui/icons-material/FiberManualRecord";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import GroupsIcon from "@mui/icons-material/Groups";
import ForumIcon from "@mui/icons-material/Forum";
import DownloadIcon from "@mui/icons-material/Download";
import ComputerIcon from "@mui/icons-material/Computer";
import PhoneAndroidIcon from "@mui/icons-material/PhoneAndroid";
import PhoneIphoneIcon from "@mui/icons-material/PhoneIphone";
import LocationCityIcon from "@mui/icons-material/LocationCity";
import SportsMartialArtsIcon from "@mui/icons-material/SportsMartialArts";
import WorkspacesIcon from "@mui/icons-material/Workspaces";
import CloseIcon from "@mui/icons-material/Close";
import imgGroup from "@/imports/c8de1fd9-6ee6-419a-91c8-954cc7ee0032.webp";
import imgGarden from "@/imports/50db5c38-8be3-4a6f-b8c3-d6188e0e594a.webp";
import imgNinjaHeadline from "@/imports/d8f34b20-3cf0-4fe5-8313-0e76f0295f3a.webp";
import imgMoonlight from "@/imports/4f5edfe0-4198-4699-9e91-557039c6bad6.webp";
import imgCharHaruki from "@/imports/characters/haruki.webp";
import imgCharLuna from "@/imports/characters/luna.webp";
import imgCharRaiken from "@/imports/characters/raiken.webp";
import imgCharKaelen from "@/imports/characters/kaelen.webp";
import imgCharVyra from "@/imports/characters/vyra.webp";
import imgCharHaejin from "@/imports/characters/haejin.webp";
import imgCharDaigo from "@/imports/characters/daigo.webp";
import { HeroAmbientBackground } from "@/features/landing/HeroAmbientBackground";
import { HERO_CHARACTER_VIDEO } from "@/shared/heroVideo";
import imgCharVorian from "@/imports/characters/vorian.webp";
import imgCharLiria from "@/imports/characters/liria.webp";
import imgCharAlric from "@/imports/characters/alric.webp";
import imgCharKairo from "@/imports/characters/kairo.webp";
import imgCharKagiri from "@/imports/characters/kagiri.webp";
import thumbCharHaruki from "@/imports/characters/haruki_thumb.webp";
import thumbCharLuna from "@/imports/characters/luna_thumb.webp";
import thumbCharRaiken from "@/imports/characters/raiken_thumb.webp";
import thumbCharKaelen from "@/imports/characters/kaelen_thumb.webp";
import thumbCharVyra from "@/imports/characters/vyra_thumb.webp";
import thumbCharHaejin from "@/imports/characters/haejin_thumb.webp";
import thumbCharDaigo from "@/imports/characters/daigo_thumb.webp";
import thumbCharVorian from "@/imports/characters/vorian_thumb.webp";
import thumbCharLiria from "@/imports/characters/liria_thumb.webp";
import thumbCharAlric from "@/imports/characters/alric_thumb.webp";
import thumbCharKairo from "@/imports/characters/kairo_thumb.webp";
import thumbCharKagiri from "@/imports/characters/kagiri_thumb.webp";
import imgPvP from "@/imports/379a1912-653d-4824-8658-f27e0424fb77.webp";
import imgCouncil from "@/imports/4360b9ce-e8c9-44c2-85fb-0ceb5225cede.webp";
import { Page, useC, SH1, SH2, SH3, FilledBtn, Chip, OutlinedBtn } from "@/app/shared";
import { api, type GameDownloadInfo } from "@/app/api";
import { formatGameFileSize } from "@/shared/gameFileSize";
import { toast } from "sonner";

const PLATFORM_META: Record<string, { label: string; Icon: typeof ComputerIcon; reqs: string }> = {
  windows: { label: "Windows", Icon: ComputerIcon, reqs: "Win 10/11 · 8GB RAM" },
  android: { label: "Android", Icon: PhoneAndroidIcon, reqs: "Android 9.0+ · 4GB RAM" },
  ios: { label: "iOS", Icon: PhoneIphoneIcon, reqs: "iOS 15+ · iPhone 12+" },
};

function formatDate(iso: string | null | undefined) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

const CHARACTERS = [
  { id:1, name:"Haruki", village:"Leaf", role:"Scout/Assassin", rarity:"Wind", clan:"Wind", color:"#3B4DB8", img:imgCharHaruki, thumb:thumbCharHaruki, bio:"Calm and observant. Movessilently like the wind. Values freedom and loyalty to his friends.", stats:{atk:89,def:80,spd:99,mgk:85}, abilities:["High Speed Movement","Hit & Run Tactics","Wind Techniques","Dual Blades"] },
  { id:2, name:"Luna", village:"Leaf", role:"Support/Healer", rarity:"Legendary", clan:"Moon Blossom", color:"#6750A4", img:imgCharLuna, thumb:thumbCharLuna, bio:"Kind, gentle and thoughtful. Always puts others before herself. Believes in protecting life with strength and compassion.", stats:{atk:78,def:80,spd:92,mgk:95}, abilities:["Water Release","Heal Allies","Control Fields","Fight with Agility & Grace"] },
  { id:3, name:"Raiken", village:"Fire", role:"Warrior/Frontliner", rarity:"Epic", clan:"Crimson Oni", color:"#B3261E", img:imgCharRaiken, thumb:thumbCharRaiken, bio:"Fierce and relentless. Lives for battle. Protects his clan with unwavering loyalty. Does not tolerate weakness.", stats:{atk:99,def:60,spd:85,mgk:65}, abilities:["Dragon Fury","Inferno Charge","Berserk","Flame Cloak"] },
  { id:4, name:"Kaelen", village:"Snow", role:"Beast Tamer", rarity:"Epic", clan:"Silver Howl", color:"#99a5ad", img:imgCharKaelen, thumb:thumbCharKaelen, bio:"Calm and confident. Deep bond with beasts. Values freedom and protects the weak.", stats:{atk:80,def:70,spd:70,mgk:94}, abilities:["Command beasts","Agility","Traps","Control the Battlefield"] },
  { id:5, name:"Vyra", village:"Petals", role:"Assassin/Debuffer", rarity:"Epic", clan:"Night Veil", color:"#7750D4", img:imgCharVyra, thumb:thumbCharVyra, bio:"Quiet and mysterious. Works alone and trusts no one. Believes in efficiency over emotions.", stats:{atk:80,def:89,spd:90,mgk:85}, abilities:["Speed","Agility","Poisoning Enemies","Weakening Enemies"] },
  { id:6, name:"Daigo", village:"Mountain", role:"Monk/Brawler", rarity:"Rare", clan:"Earth", color:"#a87625", img:imgCharDaigo, thumb:thumbCharDaigo, bio:"Disciplined and humble. Protects the weak and never backs down from a challenge.", stats:{atk:98,def:95,spd:72,mgk:77}, abilities:["Strong Close-Range Combat","Martial Art","Body Strength","Earth Energy"] },
  { id:7, name:"Liria", village:"Forest", role:"Archer", rarity:"Rare", clan:"Silverwind", color:"#386A20", img:imgCharLiria, thumb:thumbCharLiria, bio:"Calm and composed. Observant and intelligent. Values nature and freedom. Protects the weak from the shadows.", stats:{atk:80,def:85,spd:95,mgk:85}, abilities:["Long-Range Combat","Precise Shot","Mobility & Positioning","Control battlefield & Supportive"] },
  { id:8, name:"Vorian", village:"Night", role:"Mage/Crowd Control", rarity:"Rare", clan:"Shadow", color:"#1D192B", img:imgCharVorian, thumb:thumbCharVorian, bio:"Calm, intelligent and calculating. Sees the world in shades of truth and lies. Keeps emotions buried.", stats:{atk:90,def:85,spd:80,mgk:100}, abilities:["Dark Magic","Area Spell","Curse","Shadow"] },
  { id:9, name:"Haejin", village:"Shadow", role:"Detective/Assassin Leader", rarity:"Rare", clan:"Black Veil", color:"#000", img:imgCharHaejin, thumb:thumbCharHaejin, bio:"Calculating, cold and ruthless. Shows no mercy to criminals. Always three steps ahead.", stats:{atk:95,def:80,spd:85,mgk:95}, abilities:["Silent Elimination","Poison & Blade","Shadow Techniques","Espionage & Interrogation"] },
  { id:10, name:"Kairo", village:"Night", role:"Spear Fighter", rarity:"Uncommon", clan:"Earth", color:"#5C4300", img:imgCharKairo, thumb:thumbCharKairo, bio:"Silent and stoic. Carries the pain of his past.", stats:{atk:93,def:82,spd:80,mgk:78}, abilities:["Powerful Thrusts","Sweeping Attacks","Controlling Space","Breaking Enemy Formations"] },
  { id:11, name:"Alric", village:"Fire", role:"Tank/Guardian", rarity:"Uncommon", clan:"Light", color:"#3B4D98", img:imgCharAlric, thumb:thumbCharAlric, bio:"Noble and selfless. Stands firm to protect his allies and upholds his oath without hesitation.", stats:{atk:90,def:100,spd:72,mgk:70}, abilities:["Defend allies","Unbreakable Resolve","Absorbing Damage","Disrupting Enemies"] },
  { id:12, name:"Kagiri", village:"Shadow", role:"Assassin/Single Target", rarity:"Uncommon", clan:"Metal", color:"#625B71", img:imgCharKagiri, thumb:thumbCharKagiri, bio:"Cool, calculating and merciless. Moves like a whisper, ends like a blade. Her loyalty is earned through strength alone.", stats:{atk:90,def:75,spd:95,mgk:80}, abilities:["Silent Elimination","Precise Strike","Dual Tanto","Metal Tools"] },
];

const FEATURES = [
  { Icon:PublicIcon, title:"Open World", desc:"A seamless 4,000 km² living world with dynamic weather and hidden secrets." },
  { Icon:SportsEsportsIcon, title:"Arena PvP", desc:"Ranked duels, clan wars, and seasonal tournament brackets." },
  { Icon:GavelIcon, title:"Crafting", desc:"Forge legendary equipment using rare materials from all five continents." },
  { Icon:StorefrontIcon, title:"Trading", desc:"Player-driven economy with auction houses and rare item exchanges." },
  { Icon:ShieldIcon, title:"PvE Raids", desc:"Battle mythic bosses with up to 24 players in cinematic encounters." },
  { Icon:EmojiEventsIcon, title:"Guild System", desc:"Build guilds, construct strongholds, and wage territorial wars." },
  { Icon:MapIcon, title:"Missions", desc:"Thousands of story missions, dynamic quests, and daily bounties." },
  { Icon:StorefrontIcon, title:"Marketplace", desc:"Browse, list, and bid on unique items in the global ninja marketplace." },
];

const WORLD_ZONES = [
  { Icon:MapIcon, title:"5 Villages", desc:"Leaf, Fire, Shadow, Snow, and Earth — each with unique culture and mission boards." },
  { Icon:PeopleIcon, title:"Clan System", desc:"Join one of 58 clans with ancient bloodline abilities and faction reputation." },
  { Icon:AutoStoriesIcon, title:"Epic Missions", desc:"Over 1,000 missions spanning main story, side arcs, and daily contracts." },
  { Icon:SecurityIcon, title:"PvP Zones", desc:"Contested zones where player factions battle for territory and prestige." },
  { Icon:MilitaryTechIcon, title:"Guild Wars", desc:"Rally 50+ members to siege rival strongholds in weekend guild war events." },
];

const FAQS = [
  { q:"Is Ninja Era free to play?", a:"Yes! Ninja Era is free to download and play. Optional cosmetic packs are available but never affect gameplay balance." },
  { q:"What platforms is the game available on?", a:"Ninja Era is available on Windows PC, Android, and iOS. Cross-platform play is fully supported." },
  { q:"How often are updates released?", a:"Major content patches release every 6–8 weeks with smaller balance updates and events in between." },
  { q:"Is there a pay-to-win model?", a:"There is no subscription required. All premium purchases are cosmetic only — weapons, costumes, and emotes." },
  { q:"Can I play solo?", a:"Both! Most content is designed for solo play. Group content (raids, guild wars) is optional but rewards are higher." },
  { q:"How do I contact support?", a:"Use the in-game ticket system or email support@ninjaera.aleeas.com. Our team responds within 24 hours." },
];
const RARITY_COLOR: Record<string,string> = { Legendary:"#7D5260", Epic:"#6750A4", Rare:"#006688", Uncommon:"#386A20" };
const AVATAR_COLORS = ["#6750A4","#B3261E","#7D5260","#386A20","#006688","#625B71","#4A4458"];
// ── CHARACTER MODAL ──────────────────────────────────────────────────────────
function CharacterModal({ char, onClose }: { char:typeof CHARACTERS[0]|null; onClose:()=>void }) {
  const C = useC();
  const [imgFull, setImgFull] = useState(false);
  if (!char) return null;
  const eq = ["Weapon","Helmet","Armor","Gloves","Boots","Necklace","Ring"];
  const rc = RARITY_COLOR[char.rarity];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[2px]" onClick={() => { if (imgFull) setImgFull(false); else onClose(); }}>
      <div
        className="rounded-3xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col"
        style={{ background:C.surface, boxShadow:"0 8px 32px rgba(0,0,0,.24)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Image header */}
        <div
          className={`relative shrink-0 overflow-hidden ${imgFull ? "rounded-3xl" : "rounded-t-3xl"} ${char.img ? "cursor-pointer" : ""}`}
          style={{ height: imgFull ? "90vh" : "13rem" }}
          onClick={() => char.img && setImgFull(!imgFull)}
        >
          {char.img
            ? <ImageWithFallback src={char.img} alt={char.name} className="w-full h-full object-cover object-top" />
            : <div className="w-full h-full flex items-center justify-center" style={{ background:`linear-gradient(135deg,${char.color}22,${C.surfaceVar})` }}><PersonIcon style={{ fontSize:64, color:char.color, opacity:.35 }} /></div>}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent pointer-events-none" />
          <button onClick={e => { e.stopPropagation(); onClose(); }} className="absolute top-3 right-3 w-9 h-9 rounded-full bg-white/90 flex items-center justify-center hover:bg-white transition-colors" style={{ color:C.onSurface }}><CloseIcon style={{ fontSize:18 }} /></button>
          <div className="absolute bottom-3 left-4 pointer-events-none"><Chip label={char.rarity} color={rc} filled /></div>
          {char.img && (
            <div className="absolute bottom-3 right-4 w-7 h-7 rounded-full bg-black/50 flex items-center justify-center pointer-events-none">
              {imgFull ? <ExpandLessIcon style={{ fontSize:16, color:"white" }} /> : <ExpandMoreIcon style={{ fontSize:16, color:"white" }} />}
            </div>
          )}
        </div>
        {/* Content — hidden when image is expanded */}
        {!imgFull && (
          <div className="p-6 overflow-y-auto flex-1">
            <h2 className="text-2xl font-light mb-1" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>{char.name}</h2>
            <div className="flex flex-wrap gap-2 mb-4">
              {[{Icon:LocationCityIcon,txt:char.village},{Icon:SportsMartialArtsIcon,txt:char.role},{Icon:WorkspacesIcon,txt:`${char.clan} Clan`}].map(({Icon,txt}) => (
                <span key={txt} className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border" style={{ borderColor:C.outlineVar, color:C.onSurfaceVar }}>
                  <Icon style={{ fontSize:12, color:C.primary }} />{txt}
                </span>
              ))}
            </div>
            <p className="text-sm leading-relaxed mb-6" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{char.bio}</p>
            <h4 className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Combat Stats</h4>
            <div className="grid grid-cols-2 gap-3 mb-6">
              {Object.entries(char.stats).map(([k,v]) => (
                <div key={k} className="rounded-2xl p-3" style={{ background:C.surfaceVar }}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span style={{ color:C.onSurfaceVar, fontFamily:"Roboto Mono,monospace" }}>{k==="atk"?"Attack":k==="def"?"Defense":k==="spd"?"Speed":"Magic"}</span>
                    <span className="font-medium" style={{ color:C.onSurface, fontFamily:"Roboto Mono,monospace" }}>{v}</span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background:C.outlineVar }}>
                    <div className="h-full rounded-full" style={{ width:`${v}%`, background:char.color }} />
                  </div>
                </div>
              ))}
            </div>
            <h4 className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Abilities</h4>
            <div className="flex flex-wrap gap-2 mb-6">{char.abilities.map(a => <Chip key={a} label={a} color={char.color} filled />)}</div>
            <h4 className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Equipment</h4>
            <div className="grid grid-cols-4 md:grid-cols-7 gap-2">
              {eq.map(e => (
                <div key={e} className="aspect-square rounded-2xl flex flex-col items-center justify-center gap-1 p-2 hover:scale-105 transition-transform cursor-pointer" style={{ background:C.surfaceVar }}>
                  <ShieldIcon style={{ fontSize:18, color:C.onSurfaceVar }} />
                  <span className="text-[9px] text-center leading-tight" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{e}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── HOME PAGE ────────────────────────────────────────────────────────────────
const WIND_STYLE = `
@keyframes slideInWind {
  0%   { transform: translateX(-120px) rotate(-3deg); opacity: 0; }
  60%  { transform: translateX(8px) rotate(0.5deg); opacity: 1; }
  100% { transform: translateX(0) rotate(0deg); opacity: 1; }
}
@keyframes windSway {
  0%   { transform: translateX(0) rotate(0deg); }
  20%  { transform: translateX(4px) rotate(0.4deg); }
  45%  { transform: translateX(-3px) rotate(-0.3deg); }
  65%  { transform: translateX(5px) rotate(0.5deg); }
  80%  { transform: translateX(-2px) rotate(-0.2deg); }
  100% { transform: translateX(0) rotate(0deg); }
}
.hero-title-ninja {
  animation: slideInWind 0.9s cubic-bezier(0.22, 1, 0.36, 1) both,
             windSway 6s ease-in-out 1s infinite;
}
.hero-title-era {
  animation: slideInWind 0.9s cubic-bezier(0.22, 1, 0.36, 1) 0.18s both,
             windSway 6s ease-in-out 1.18s infinite;
}
`;
function HomePage({ setPage, onGoToDownload }: { setPage:(p:Page)=>void; onGoToDownload?: () => void }) {
  const C = useC();
  const [sel, setSel] = useState<typeof CHARACTERS[0]|null>(null);
  const [faq, setFaq] = useState<number|null>(null);
  const [gameDownloads, setGameDownloads] = useState<GameDownloadInfo[]>([]);

  useEffect(() => {
    api.content.gameDownloads().then(r => setGameDownloads(r.downloads)).catch(() => {});
  }, []);

  const handleGameDownload = async (platform: string, available: boolean) => {
    if (!available) {
      toast.info("No published build is available for this platform yet.");
      return;
    }
    try {
      await api.content.downloadGame(platform);
    } catch {
      toast.error("Download failed. Please try again.");
    }
  };
  return (
    <div style={{ background:C.bg }}>
      <style dangerouslySetInnerHTML={{ __html: WIND_STYLE }} />
      {/* HERO */}
      <section data-nav-hero className="relative min-h-screen flex items-center overflow-hidden">
        <HeroAmbientBackground
          src={imgGroup}
          alt="Ninja Era heroes"
          videoWebm={HERO_CHARACTER_VIDEO.webm}
          videoMp4={HERO_CHARACTER_VIDEO.mp4}
        />
        <div className="relative z-10 max-w-7xl mx-auto px-6 pt-24 pb-20 w-full">
          <div className="max-w-lg">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-6 text-xs font-medium" style={{ background:C.primaryCont, color:C.onPrimaryCont, fontFamily:"Roboto" }}>
              <FiberManualRecordIcon style={{ fontSize:8, color:C.primary }} /> NOW IN OPEN BETA
            </div>
            <h1 className="hero-title-ninja text-7xl md:text-9xl font-light text-white leading-none mb-1" style={{ fontFamily:"'Trade Winds', cursive" }}>Ninja</h1>
            <h1 className="hero-title-era text-5xl md:text-7xl font-black text-white leading-none mb-5" style={{ fontFamily:"'Trade Winds', cursive" }}>Era</h1>
            <p className="text-lg font-light text-white/90 mb-2" style={{ fontFamily:"Roboto" }}>The World of Shinobi Awaits</p>
            <p className="text-sm text-white/70 leading-relaxed mb-8 max-w-md" style={{ fontFamily:"Roboto" }}>Enter a living MMORPG world of ancient clans, forbidden jutsu, and endless conflict. Build your legend across five villages.</p>
            <div className="flex flex-wrap gap-3">
              <button onClick={() => setPage("signup")} className="flex items-center gap-2 px-7 py-3 rounded-full text-sm font-medium text-white hover:shadow-lg transition-all" style={{ background:C.primary, fontFamily:"Roboto", boxShadow:SH2 }}>
                <PlayArrowIcon style={{ fontSize:18 }} /> Play Now
              </button>
              <button onClick={() => document.getElementById("ne-features")?.scrollIntoView({ behavior:"smooth" })} className="flex items-center gap-2 px-7 py-3 rounded-full text-sm font-medium text-white border border-white/40 hover:bg-white/10 transition-all" style={{ fontFamily:"Roboto" }}>
                Learn More <ExpandMoreIcon style={{ fontSize:18 }} />
              </button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 text-white/50 animate-bounce z-10"><ExpandMoreIcon style={{ fontSize:28 }} /></div>
      </section>

      {/* INTRO */}
      <section className="py-24" style={{ background:C.bg }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-14 items-center">
            <div className="rounded-3xl overflow-hidden" style={{ boxShadow:SH3 }}>
              <ImageWithFallback src={imgNinjaHeadline} alt="Garden" className="w-full h-80 object-cover hover:scale-105 transition-transform duration-700" />
            </div>
            <div>
              <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>About the Game</p>
              <h2 className="text-3xl md:text-4xl font-light mb-5 leading-tight" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>A World Shaped by<br /><span className="font-medium">Shinobi Legacy</span></h2>
              <p className="text-sm leading-relaxed mb-8" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Ninja Era is an open-world MMORPG set in feudal fantasy Japan where clans have battled for centuries. Choose your village, master your jutsu, and write your name into history.</p>
              <div className="grid grid-cols-2 gap-4">
                {[["Unknown","Active Players"],["1,000+","Missions & Quests"],["58","Playable Clans"],["5","World Villages"]].map(([v,l]) => (
                  <div key={l} className="rounded-2xl p-4" style={{ background:C.surfaceVar }}>
                    <div className="text-2xl font-medium mb-0.5" style={{ color:C.primary, fontFamily:"Roboto" }}>{v}</div>
                    <div className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{l}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WORLD */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0">
          <ImageWithFallback src={imgGarden} alt="Combat" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/75" />
        </div>
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-medium tracking-widest uppercase mb-3 text-white/60" style={{ fontFamily:"Roboto" }}>Explore the World</p>
            <h2 className="text-3xl md:text-5xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>The <span className="font-medium">Five Nations</span></h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {WORLD_ZONES.map(z => (
              <div key={z.title} className="rounded-3xl p-5 hover:scale-[1.03] transition-all cursor-pointer" style={{ background:"rgba(255,255,255,.10)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,.15)" }}>
                <div className="w-11 h-11 rounded-full mb-4 flex items-center justify-center" style={{ background:C.primaryCont }}><z.Icon style={{ fontSize:20, color:C.primary }} /></div>
                <h3 className="text-white font-medium text-sm mb-2" style={{ fontFamily:"Roboto" }}>{z.title}</h3>
                <p className="text-white/60 text-xs leading-relaxed" style={{ fontFamily:"Roboto" }}>{z.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section id="ne-features" className="py-24" style={{ background:C.surfaceVar }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>Game Systems</p>
            <h2 className="text-3xl md:text-4xl font-light" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Core <span className="font-medium">Features</span></h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="rounded-3xl p-6 hover:scale-[1.02] transition-all cursor-pointer" style={{ background:C.surface, boxShadow:SH1 }}>
                <div className="w-12 h-12 rounded-full mb-4 flex items-center justify-center" style={{ background:C.primaryCont }}><f.Icon style={{ fontSize:22, color:C.primary }} /></div>
                <h3 className="font-medium text-sm mb-2" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{f.title}</h3>
                <p className="text-xs leading-relaxed" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHARACTERS */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0">
          <ImageWithFallback src={imgPvP} alt="Moonlit" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/72" />
        </div>
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-medium tracking-widest uppercase mb-3 text-white/60" style={{ fontFamily:"Roboto" }}>The Roster</p>
            <h2 className="text-3xl md:text-5xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>Legendary <span className="font-medium">Warriors</span></h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-5 md:gap-6">
            {CHARACTERS.map(c => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSel(c)}
                className="group rounded-3xl overflow-hidden text-left w-full transition-all duration-300 ease-out hover:scale-[1.03] hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ background:C.surface, boxShadow:SH2, ["--tw-ring-color" as string]:C.primary }}
              >
                <div className="relative aspect-[3/4] overflow-hidden">
                  {(c.thumb || c.img)
                    ? <ImageWithFallback
                        src={c.thumb || c.img!}
                        alt={c.name}
                        className="w-full h-full object-cover object-top transition-transform duration-500 ease-out group-hover:scale-105"
                        loading="lazy"
                        decoding="async"
                      />
                    : <div className="w-full h-full flex items-center justify-center" style={{ background:`linear-gradient(135deg,${c.color}22,${C.surfaceVar})` }}><PersonIcon style={{ fontSize:64, color:c.color, opacity:.4 }} /></div>}
                  <div className="absolute top-3 right-3">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full text-white" style={{ background:RARITY_COLOR[c.rarity] }}>{c.rarity[0]}</span>
                  </div>
                </div>
                <div className="p-4">
                  <p className="font-medium text-sm leading-tight mb-1 truncate" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{c.name}</p>
                  <p className="text-xs truncate" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{c.role}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
        {sel && <CharacterModal char={sel} onClose={() => setSel(null)} />}
      </section>

      {/* GAMEPLAY */}
      <section className="py-24" style={{ background:C.bg }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>In Action</p>
            <h2 className="text-3xl font-light" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Gameplay <span className="font-medium">Experience</span></h2>
          </div>
          <div className="grid md:grid-cols-2 gap-10 items-center mb-14">
            <div className="rounded-3xl overflow-hidden" style={{ boxShadow:SH3 }}>
              <ImageWithFallback src={imgMoonlight} alt="PvP" className="w-full h-72 object-cover" />
            </div>
            <div className="space-y-6">
              {[
                { Icon:SecurityIcon, title:"Real-Time Combat", desc:"Fluid skill-based combat with combo chains, parries, and ultimate jutsu finishers." },
                { Icon:MapIcon, title:"Open World Exploration", desc:"Seamless 4,000 km² map with dynamic weather, day/night cycles, and hidden secrets." },
                { Icon:GroupsIcon, title:"Multiplayer Raids", desc:"Form parties of up to 24 players for the hardest PvE content in the game." },
              ].map(item => (
                <div key={item.title} className="flex gap-4">
                  <div className="w-12 h-12 shrink-0 rounded-full flex items-center justify-center" style={{ background:C.primaryCont }}><item.Icon style={{ fontSize:22, color:C.primary }} /></div>
                  <div>
                    <h4 className="font-medium mb-1 text-sm" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{item.title}</h4>
                    <p className="text-xs leading-relaxed" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {/* 4.9 */}
            {[["Unknown","App Store Rating"],["99.9%","Uptime SLA"],["24/7","Live Support"],["<20ms","Avg. Ping"]].map(([v,l]) => (
              <div key={l} className="rounded-3xl p-5 text-center" style={{ background:C.surfaceVar }}>
                <div className="text-2xl font-medium mb-1" style={{ color:C.primary, fontFamily:"Roboto" }}>{v}</div>
                <div className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{l}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMMUNITY */}
      <section className="relative py-24 overflow-hidden">
        <div className="absolute inset-0">
          <ImageWithFallback src={imgCouncil} alt="Game" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-black/75" />
        </div>
        <div className="relative max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-medium tracking-widest uppercase mb-3 text-white/60" style={{ fontFamily:"Roboto" }}>Join Us</p>
            <h2 className="text-3xl md:text-5xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>The <span className="font-medium">Game</span></h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-12">
            {[
              // 180K Members
              { Icon:ForumIcon, title:"Discord", val:"Unknown", desc:"Real-time chat, help, and raid organization." },
              { Icon:EmojiEventsIcon, title:"Leaderboards", val:"Weekly Prizes", desc:"Compete in ranked seasons with real rewards." },
              { Icon:MilitaryTechIcon, title:"Guild Wars", val:"Every Saturday", desc:"Massive 50v50 territorial battles." },
              { Icon:PublicIcon, title:"Global Events", val:"Daily Events", desc:"Server-wide events with rare item drops." },
            ].map(c => (
              <div key={c.title} className="rounded-3xl p-6 hover:scale-[1.02] transition-all cursor-pointer" style={{ background:"rgba(255,255,255,.10)", backdropFilter:"blur(12px)", border:"1px solid rgba(255,255,255,.15)" }}>
                <div className="w-11 h-11 rounded-full mb-3 flex items-center justify-center" style={{ background:C.secondaryCont }}><c.Icon style={{ fontSize:22, color:C.secondary }} /></div>
                <div className="text-xs font-medium mb-1 text-white/70" style={{ fontFamily:"Roboto" }}>{c.val}</div>
                <h3 className="text-white font-medium text-sm mb-1" style={{ fontFamily:"Roboto" }}>{c.title}</h3>
                <p className="text-white/55 text-xs" style={{ fontFamily:"Roboto" }}>{c.desc}</p>
              </div>
            ))}
          </div>
          <div className="text-center">
            <button
              onClick={() => (onGoToDownload ? onGoToDownload() : document.getElementById("ne-download")?.scrollIntoView({ behavior: "smooth", block: "start" }))}
              className="inline-flex items-center gap-2 px-8 py-3.5 rounded-full text-sm font-medium hover:opacity-90 transition-all"
              style={{ background:C.primaryCont, color:C.onPrimaryCont, fontFamily:"Roboto", boxShadow:SH2 }}
            >
              Join the Game <ArrowForwardIcon style={{ fontSize:18 }} />
            </button>
          </div>
        </div>
      </section>

      {/* DOWNLOAD */}
      <section id="ne-download" className="py-24 scroll-mt-20" style={{ background:C.bg }}>
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-14">
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>Get the Game</p>
            <h2 className="text-3xl font-light" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Download <span className="font-medium">Free</span></h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-3xl mx-auto">
            {(["windows", "android", "ios"] as const).map(platform => {
              const meta = PLATFORM_META[platform];
              const info = gameDownloads.find(d => d.platform === platform);
              const available = info?.available ?? false;
              return (
                <div key={platform} className="rounded-3xl p-6 text-center hover:scale-[1.02] transition-all" style={{ background:C.surface, boxShadow:SH1 }}>
                  <div className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background:C.primaryCont }}><meta.Icon style={{ fontSize:28, color:C.primary }} /></div>
                  <h3 className="font-medium text-base mb-1" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{meta.label}</h3>
                  {available ? (
                    <>
                      <p className="text-xs font-medium mb-1" style={{ color:C.primary, fontFamily:"Roboto Mono,monospace" }}>v{info?.version}</p>
                      {/* <p className="text-xs mb-1" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{formatGameFileSize(info?.fileSize, info?.fileSizeUnit)} · {formatDate(info?.publishedAt)}</p> */}
                      <p className="text-xs mb-1" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{formatDate(info?.publishedAt)}</p>
                      <p className="text-[10px] mb-5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{meta.reqs}</p>
                      <FilledBtn cls="w-full justify-center" onClick={() => handleGameDownload(platform, true)}><DownloadIcon style={{ fontSize:16 }} />Download</FilledBtn>
                    </>
                  ) : (
                    <>
                      <p className="text-xs mb-5" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Currently unavailable</p>
                      <OutlinedBtn cls="w-full justify-center opacity-60" onClick={() => handleGameDownload(platform, false)}>Unavailable</OutlinedBtn>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24" style={{ background:C.surfaceVar }}>
        <div className="max-w-2xl mx-auto px-6">
          <div className="text-center mb-12">
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>FAQ</p>
            <h2 className="text-3xl font-light" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Frequently <span className="font-medium">Asked</span></h2>
          </div>
          <div className="space-y-2">
            {FAQS.map((f,i) => (
              <div key={i} className="rounded-2xl overflow-hidden" style={{ background:C.surface, boxShadow:SH1 }}>
                <button onClick={() => setFaq(faq===i?null:i)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#6750A4]/4 transition-colors">
                  <span className="text-sm font-medium" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{f.q}</span>
                  {faq===i ? <ExpandLessIcon style={{ fontSize:20, color:C.primary }} /> : <ExpandMoreIcon style={{ fontSize:20, color:C.onSurfaceVar }} />}
                </button>
                {faq===i && <div className="px-5 pb-4 text-sm leading-relaxed border-t pt-3" style={{ color:C.onSurfaceVar, borderColor:C.outlineVar, fontFamily:"Roboto" }}>{f.a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20" style={{ background:C.primary }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <h2 className="text-3xl md:text-4xl font-light text-white mb-4" style={{ fontFamily:"'Trade Winds', cursive" }}>Your Era <span className="font-medium">Begins Now</span></h2>
          <p className="text-white/70 mb-8" style={{ fontFamily:"Roboto" }}>Join 500,000+ warriors forging their legend in Ninja Era.</p>
          <button onClick={() => setPage("signup")} className="inline-flex items-center gap-2 px-10 py-3.5 rounded-full text-sm font-medium hover:opacity-90 transition-all" style={{ background:"white", color:C.primary, fontFamily:"Roboto", boxShadow:SH2 }}>
            Create Free Account <ArrowForwardIcon style={{ fontSize:18 }} />
          </button>
        </div>
      </section>
    </div>
  );
}

export default HomePage;
