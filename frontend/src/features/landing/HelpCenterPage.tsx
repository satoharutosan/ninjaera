import { useC, SH1 } from "@/app/shared";

const SECTIONS = [
  {
    id: "getting-started",
    title: "Getting Started",
    body: "Create an account, explore the landing page, and download the client when builds are published. New players should start on Home for story, characters, and install links.",
  },
  {
    id: "account",
    title: "Account",
    body: "Manage your username, avatar, notifications, and password from Profile. Security settings such as two-factor authentication can be enabled under Settings.",
  },
  {
    id: "messages",
    title: "Messages",
    body: "Use Messages for public channels and direct messages with team members. Unread indicators appear for messages posted after your last visit. Jump to latest keeps you at the bottom of active chats.",
  },
  {
    id: "teamwork",
    title: "Teamwork",
    body: "Apply to join the Ninja Era team, review open roles, and message approved teammates. Team membership may unlock private channels and resource downloads.",
  },
  {
    id: "downloads",
    title: "Downloads",
    body: "Game builds for Windows, Android, and iOS appear in the Download section on the landing page when published by administrators.",
  },
  {
    id: "resources",
    title: "Resources",
    body: "Team resources (guides, assets, and tools) live under Resources. Some files require team membership to download.",
  },
  {
    id: "faq",
    title: "Frequently Asked Questions",
    body: "More FAQs will be added as the platform grows. For urgent issues, use Bug Reports or Contact.",
  },
] as const;

const FAQS = [
  {
    q: "Why are Achievements and Inventory locked?",
    a: "Those sections unlock after you begin playing Ninja Era and your game account syncs progression data.",
  },
  {
    q: "I opened Messages and landed at old chat history.",
    a: "The first visit now treated existing channel messages as already read. New messages after that visit show unread indicators as usual.",
  },
  {
    q: "Where do I download the game?",
    a: "Use the Download Free section on the Home page, or the Game link in the footer.",
  },
] as const;

function HelpCenterPage() {
  const C = useC();

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Support</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Help Center</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Guides for accounts, messaging, teamwork, and downloads. This space is structured for searchable documentation as content expands.
          </p>
        </header>

        <nav className="rounded-2xl border p-4 mb-8" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }} aria-label="Help topics">
          <p className="text-sm font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Topics</p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm hover:underline" style={{ color: C.primary, fontFamily: "Roboto" }}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-4 mb-10">
          {SECTIONS.map(s => (
            <section
              key={s.id}
              id={s.id}
              className="rounded-2xl border p-5 sm:p-6 scroll-mt-24"
              style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}
            >
              <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{s.title}</h2>
              <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{s.body}</p>
            </section>
          ))}
        </div>

        <section className="rounded-2xl border p-5 sm:p-6" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <h2 className="text-lg font-medium mb-4" style={{ color: C.onSurface, fontFamily: "Roboto" }}>FAQ</h2>
          <div className="space-y-4">
            {FAQS.map(f => (
              <div key={f.q}>
                <h3 className="text-sm font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>{f.q}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>{f.a}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export default HelpCenterPage;
