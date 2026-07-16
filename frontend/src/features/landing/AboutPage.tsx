import { useState, useEffect, useCallback } from "react";
import { ImageWithFallback } from "@/app/components/figma/ImageWithFallback";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import GroupsIcon from "@mui/icons-material/Groups";
import HighQualityIcon from "@mui/icons-material/HighQuality";
import LightbulbIcon from "@mui/icons-material/Lightbulb";
import VisibilityIcon from "@mui/icons-material/Visibility";
import PublicIcon from "@mui/icons-material/Public";
import TheaterComedyIcon from "@mui/icons-material/TheaterComedy";
import HandshakeIcon from "@mui/icons-material/Handshake";
import ForumIcon from "@mui/icons-material/Forum";
import CodeIcon from "@mui/icons-material/Code";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import imgGroup from "@/imports/84ae1a63-6b3c-411f-98f1-6d4fdb9346bd.webp";
import imgCouncil from "@/imports/4360b9ce-e8c9-44c2-85fb-0ceb5225cede.webp";
import imgGarden from "@/imports/50db5c38-8be3-4a6f-b8c3-d6188e0e594a.webp";
import { Page, useC, SH1, SH2 } from "@/app/shared";
import { api, type OurStoryPublic } from "@/app/api";
import { onRealtimeEvent } from "@/app/realtime";
import { renderStoryMarkdown } from "@/shared/storyMarkdown";

const VALUES = [
  { title: "Creativity", desc: "Bold anime-inspired worlds, characters, and stories that stay memorable.", Icon: AutoAwesomeIcon },
  { title: "Community", desc: "Players and creators shape Ninja Era together — feedback is part of the craft.", Icon: GroupsIcon },
  { title: "Quality", desc: "Polish over padding. Every release should feel intentional and reliable.", Icon: HighQualityIcon },
  { title: "Innovation", desc: "Realtime teamwork, calls, and tooling built for modern community play.", Icon: LightbulbIcon },
  { title: "Transparency", desc: "Open development notes, honest roadmaps, and respectful moderation.", Icon: VisibilityIcon },
];

const WHY = [
  { title: "Global community", desc: "Connect with players and teammates across regions in one living hub.", Icon: PublicIcon },
  { title: "Anime-inspired design", desc: "Visual language rooted in shinobi fantasy without losing clarity online.", Icon: TheaterComedyIcon },
  { title: "Teamwork first", desc: "Channels, DMs, voice notes, and group play designed for collaboration.", Icon: HandshakeIcon },
  { title: "Realtime communication", desc: "Messages, presence, and calling stay responsive on web and devices.", Icon: ForumIcon },
  { title: "Open development", desc: "Plantend builds in public — share bugs, ideas, and join the mission.", Icon: CodeIcon },
];

const FAQ = [
  { q: "What is Plantend?", a: "Plantend is the studio behind Ninja Era — an indie team focused on anime-inspired games and the community platforms that support them." },
  { q: "Is Ninja Era free to play?", a: "Yes. Ninja Era is free to download and play. Optional cosmetics never affect competitive balance." },
  { q: "How can I join the team?", a: "Visit Teamwork to apply for open roles, or Contact Us if you want to collaborate as a creator or partner." },
  { q: "Where do I report bugs?", a: "Use the Bugs page or Contact form. Admins and team members review submissions regularly." },
  { q: "Which platforms are supported?", a: "Ninja Era targets Windows, Android, and iOS with cross-play in progress across the live roadmap." },
];

const FALLBACK_STORY: OurStoryPublic = {
  slug: "about-our-story",
  title: "Our Story",
  subtitle: "Building the next generation anime RPG.",
  body: "Plantend began as a passionate indie group pursuing a shinobi MMORPG.\n\nFrom closed tests of combat and villages to a living community platform with messaging, resources, and teamwork applications, every chapter has been shaped with players and creators.\n\nToday Ninja Era continues to grow — with calls, moderation tools, and an open road ahead built together with the community.",
  quote: "Every legend begins with a single step.",
  imageUrl: null,
  updatedAt: "",
  publishedAt: null,
};

function AboutPage({ setPage }: { setPage: (p: Page) => void }) {
  const C = useC();
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  const [story, setStory] = useState<OurStoryPublic>(FALLBACK_STORY);

  const loadStory = useCallback(() => {
    api.content.ourStory()
      .then((r) => setStory(r.content))
      .catch(() => { /* keep fallback */ });
  }, []);

  useEffect(() => {
    loadStory();
    return onRealtimeEvent<{ slug?: string }>("content:update", (payload) => {
      if (!payload?.slug || payload.slug === "about-our-story") loadStory();
    });
  }, [loadStory]);

  const storyImage = story.imageUrl || imgCouncil;

  return (
    <div style={{ background: C.bg }} className="pt-16">
      {/* Hero — full-bleed brand composition */}
      <section className="relative min-h-[70vh] flex items-end overflow-hidden">
        <ImageWithFallback
          src={imgGroup}
          alt="Plantend warriors"
          className="absolute inset-0 w-full h-full object-cover"
          loading="eager"
        />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.82) 0%, rgba(0,0,0,.35) 55%, rgba(0,0,0,.25) 100%)" }} />
        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pb-16 pt-32">
          <p className="text-xs font-medium tracking-[0.2em] uppercase mb-3 text-white/70" style={{ fontFamily: "Roboto" }}>Plantend Studio</p>
          <h1 className="text-5xl md:text-7xl font-light text-white mb-4" style={{ fontFamily: "'Trade Winds', cursive" }}>
            About <span className="font-medium">Plantend</span>
          </h1>
          <p className="text-base md:text-lg max-w-xl text-white/85 mb-8 leading-relaxed" style={{ fontFamily: "Roboto" }}>
            We craft Ninja Era and the living community around it — a studio dedicated to teamwork, story, and anime-inspired worlds.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setPage("signup")}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full text-sm font-medium text-white hover:opacity-95 transition-all"
              style={{ background: C.primary, fontFamily: "Roboto", boxShadow: SH2 }}
            >
              Join the Game <ArrowForwardIcon style={{ fontSize: 18 }} />
            </button>
            <button
              type="button"
              onClick={() => setPage("teamwork")}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full text-sm font-medium border border-white/40 text-white hover:bg-white/10 transition-all"
              style={{ fontFamily: "Roboto" }}
            >
              Apply to the Team
            </button>
          </div>
        </div>
      </section>

      {/* Who we are */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: C.primary, fontFamily: "Roboto" }}>Who we are</p>
            <h2 className="text-3xl md:text-4xl font-light mb-5" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
              Mission, vision &amp; <span className="font-medium">craft</span>
            </h2>
            <p className="text-sm leading-relaxed mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Plantend builds Ninja Era as a long-term living world — and builds the platforms players use to organize, chat, and grow together.
            </p>
            <p className="text-sm leading-relaxed mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Our philosophy is simple: ship thoughtfully, listen carefully, and keep the vibe of an indie studio even as the community scales.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              From real-time messaging and calling to resources and team applications, everything we ship supports one goal — helping legends form together.
            </p>
          </div>
          <div className="rounded-3xl overflow-hidden min-h-[260px]" style={{ boxShadow: SH2 }}>
            <ImageWithFallback src={imgCouncil} alt="Plantend council" className="w-full h-full object-cover min-h-[260px]" loading="lazy" />
          </div>
        </div>
      </section>

      {/* Our Story — CMS driven */}
      <section className="py-16" style={{ background: C.surfaceVar }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className={`grid gap-10 items-center ${story.imageUrl ? "md:grid-cols-2" : ""}`}>
            <div>
              <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: C.primary, fontFamily: "Roboto" }}>About</p>
              <h2 className="text-3xl md:text-4xl font-light mb-3" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
                {story.title || "Our Story"}
              </h2>
              {!!story.subtitle?.trim() && (
                <p className="text-sm mb-5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{story.subtitle}</p>
              )}
              <div className="mb-4">{renderStoryMarkdown(story.body, C.onSurfaceVar)}</div>
              {!!story.quote?.trim() && (
                <blockquote className="pl-4 border-l-4 italic text-sm" style={{ borderColor: C.primary, color: C.onSurface, fontFamily: "Roboto" }}>
                  {story.quote}
                </blockquote>
              )}
            </div>
            {story.imageUrl && (
              <div className="rounded-3xl overflow-hidden min-h-[240px] order-first md:order-last" style={{ boxShadow: SH2 }}>
                <ImageWithFallback src={storyImage} alt={story.title || "Our Story"} className="w-full h-full object-cover min-h-[240px]" loading="lazy" />
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-light text-center mb-3" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
          Core <span className="font-medium">Values</span>
        </h2>
        <p className="text-sm text-center mb-10 max-w-lg mx-auto" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
          Principles that guide every patch, conversation tool, and community decision.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {VALUES.map(({ title, desc, Icon }) => (
            <div key={title} className="rounded-2xl p-5" style={{ background: C.surface, boxShadow: SH1 }}>
              <div className="w-11 h-11 rounded-xl flex items-center justify-center mb-3" style={{ background: C.primaryCont, color: C.primary }}>
                <Icon style={{ fontSize: 22 }} />
              </div>
              <h3 className="font-medium text-sm mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Why Plantend */}
      <section className="py-16" style={{ background: C.surface }}>
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid md:grid-cols-2 gap-10 items-center mb-12">
            <div className="rounded-3xl overflow-hidden min-h-[220px] order-2 md:order-1" style={{ boxShadow: SH2 }}>
              <ImageWithFallback src={imgGarden} alt="Plantend world" className="w-full h-full object-cover min-h-[220px]" loading="lazy" />
            </div>
            <div className="order-1 md:order-2">
              <p className="text-xs font-medium tracking-widest uppercase mb-3" style={{ color: C.primary, fontFamily: "Roboto" }}>Why Plantend</p>
              <h2 className="text-3xl font-light mb-4" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
                More than a <span className="font-medium">game client</span>
              </h2>
              <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Ninja Era is the adventure. Plantend is the studio and platform that keep players, members, and moderators connected in real time.
              </p>
            </div>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {WHY.map(({ title, desc, Icon }) => (
              <div key={title} className="rounded-2xl p-5 border" style={{ borderColor: C.outlineVar, background: C.bg }}>
                <Icon style={{ fontSize: 28, color: C.primary, marginBottom: 10 }} />
                <h3 className="font-medium text-sm mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{title}</h3>
                <p className="text-xs leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-3xl mx-auto px-6 py-20">
        <h2 className="text-3xl font-light text-center mb-10" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
          FAQ
        </h2>
        <div className="space-y-2">
          {FAQ.map((item, i) => {
            const open = openFaq === i;
            return (
              <div key={item.q} className="rounded-2xl border overflow-hidden" style={{ borderColor: C.outlineVar, background: C.surface }}>
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpenFaq(open ? null : i)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left"
                >
                  <span className="text-sm font-medium" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{item.q}</span>
                  <ExpandMoreIcon style={{ fontSize: 22, color: C.onSurfaceVar, transform: open ? "rotate(180deg)" : undefined, transition: "transform 0.2s" }} />
                </button>
                {open && (
                  <p className="px-4 pb-4 text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{item.a}</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Final CTA */}
      <section className="relative overflow-hidden py-24">
        <ImageWithFallback src={imgGroup} alt="" className="absolute inset-0 w-full h-full object-cover opacity-30" loading="lazy" />
        <div className="absolute inset-0" style={{ background: C.primary, opacity: 0.92 }} />
        <div className="relative z-10 max-w-2xl mx-auto px-6 text-center">
          <h2 className="text-4xl font-light text-white mb-4" style={{ fontFamily: "'Trade Winds', cursive" }}>
            Ready to begin?
          </h2>
          <p className="text-white/80 mb-8 text-sm" style={{ fontFamily: "Roboto" }}>
            Join the game, apply to the team, or send us a message — the next chapter starts with you.
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            <button type="button" onClick={() => setPage("signup")} className="px-8 py-3 rounded-full text-sm font-medium bg-white hover:opacity-90 transition-opacity" style={{ color: C.primary, fontFamily: "Roboto" }}>
              Join the Game
            </button>
            <button type="button" onClick={() => setPage("teamwork")} className="px-8 py-3 rounded-full text-sm font-medium border border-white/50 text-white hover:bg-white/10 transition-colors" style={{ fontFamily: "Roboto" }}>
              Apply to the Team
            </button>
            <button type="button" onClick={() => setPage("contact")} className="px-8 py-3 rounded-full text-sm font-medium border border-white/50 text-white hover:bg-white/10 transition-colors" style={{ fontFamily: "Roboto" }}>
              Contact Us
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

export default AboutPage;
