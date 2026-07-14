import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import imgGroup from "@/imports/1537d762-6d18-4aa6-8e4a-9b1fdcd1fa68.png";
import imgCouncil from "@/imports/8c2eec24-7cf8-4c14-a64f-ae84f82b1296.png";
import { useC, SH1, SH3 } from "@/app/shared";

function AboutPage() {
  const C = useC();
  return (
    <div style={{ background:C.bg }} className="pt-16">
      <div className="relative h-[50vh] overflow-hidden">
        <ImageWithFallback src={imgGroup} alt="Warriors" className="w-full h-full object-cover" />
        <div className="absolute inset-0" style={{ background:"linear-gradient(to bottom,rgba(0,0,0,.3),rgba(0,0,0,.6))" }} />
        <div className="absolute inset-0 flex items-center justify-center">
          <h1 className="text-5xl md:text-6xl font-light text-white" style={{ fontFamily:"'Trade Winds', cursive" }}>About <span className="font-medium">Us</span></h1>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-14 mb-20">
          <div>
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color:C.primary, fontFamily:"Roboto" }}>Our Story</p>
            <h2 className="text-3xl font-light mb-5" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Born from Passion for<br /><span className="font-medium">Anime & Gaming</span></h2>
            <p className="text-sm leading-relaxed mb-4" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Ninja Era Studio was founded in 2020 by seasoned developers and anime enthusiasts who dreamed of creating the ultimate shinobi MMORPG. What started as an indie project has grown to 500,000+ active players.</p>
            <p className="text-sm leading-relaxed" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>Our team of 150+ developers, artists, and community managers works tirelessly to bring new content monthly and deepen our community relationship.</p>
          </div>
          <div className="rounded-3xl overflow-hidden" style={{ boxShadow:SH3 }}>
            <ImageWithFallback src={imgCouncil} alt="Dev council" className="w-full h-full object-cover min-h-64" />
          </div>
        </div>
        <h2 className="text-2xl font-light text-center mb-10" style={{ color:C.onSurface, fontFamily:"'Trade Winds', cursive" }}>Development <span className="font-medium">Timeline</span></h2>
        <div className="max-w-2xl mx-auto space-y-3 mb-20">
          {[
            { year:"2020", title:"Studio Founded", desc:"12-person core team established in Tokyo." },
            { year:"2021", title:"Alpha Release", desc:"Internal alpha testing. Core combat systems finalized." },
            { year:"2022", title:"Closed Beta", desc:"100,000 testers. Major feedback drives redesign." },
            { year:"2023", title:"Open Beta", desc:"Public PC beta. 300K registrations in first week." },
            { year:"2024", title:"Full Launch", desc:"v1.0 released on PC, Android, and iOS." },
            { year:"2025", title:"Expansion", desc:"Shadow Continent adds 3 new villages and 500 missions." },
          ].map((t,i) => (
            <div key={t.year} className="flex gap-4 items-start">
              <div className="w-16 h-16 shrink-0 rounded-full flex items-center justify-center text-white text-sm font-medium" style={{ background:i%2===0?C.primary:C.secondary, fontFamily:"Roboto" }}>{t.year}</div>
              <div className="flex-1 rounded-2xl p-4 mt-2" style={{ background:C.surface, boxShadow:SH1 }}>
                <h4 className="font-medium text-sm mb-1" style={{ color:C.onSurface, fontFamily:"Roboto" }}>{t.title}</h4>
                <p className="text-xs" style={{ color:C.onSurfaceVar, fontFamily:"Roboto" }}>{t.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <div className="rounded-3xl p-10 text-center" style={{ background:C.primaryCont }}>
          <h2 className="text-3xl font-light mb-4" style={{ color:C.onPrimaryCont, fontFamily:"'Trade Winds', cursive" }}>Our <span className="font-medium">Vision</span></h2>
          <p className="text-sm leading-relaxed max-w-2xl mx-auto" style={{ color:C.onPrimaryCont, fontFamily:"Roboto" }}>A great MMORPG is more than a game — it is a world. Our vision is to create a living ninja universe that grows with its community, tells meaningful stories, and gives every player the power to become legend.</p>
        </div>
      </div>
    </div>
  );
}

export default AboutPage;
