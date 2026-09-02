import type { MouseEvent } from "react";
import { useEffect } from "react";
import { useC, SH1, FilledBtn, type Page } from "@/app/shared";
import { registerAppInstallationSilent } from "@/shared/appInstallRegistration";

const SECTIONS = [
  { id: "oq-about", title: "About Orion Quest" },
  { id: "oq-using", title: "How to Use" },
  { id: "oq-browser", title: "Using in Browser" },
  { id: "oq-rewards", title: "Rewards & Profile" },
  { id: "oq-roadmap", title: "Coming Soon" },
  { id: "oq-support", title: "Support" },
  { id: "oq-privacy", title: "Privacy Practices" },
] as const;

function scrollToSection(e: MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function OrionQuestPage({ setPage }: { setPage?: (p: Page) => void }) {
  const C = useC();

  useEffect(() => {
    void registerAppInstallationSilent({
      appId: "orion-quest",
      appName: "Orion Quest",
      defaultVersion: "1.0.0",
    });
  }, []);

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>
            Community Tool
          </p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Orion Quest
          </h1>
          <p className="text-base font-medium mb-3" style={{ color: C.primary, fontFamily: "Roboto" }}>
            The cutest Discord mod now in your browser
          </p>
          <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            OrionQuest helps community members automatically complete Discord Quests so everyone can
            unlock Nitro rewards and decorate their profile.
          </p>
        </header>

        <div
          className="rounded-2xl border p-4 mb-8"
          style={{ background: C.surfaceVar, borderColor: C.primary, boxShadow: SH1 }}
          role="note"
        >
          <p className="text-sm font-medium leading-relaxed" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            IF SOMETHING BREAKS, PLEASE USE OUR SUPPORT CHANNEL INSTEAD OF LEAVING A NEGATIVE REVIEW!
          </p>
          <p className="text-sm leading-relaxed mt-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Temporary breakages happen when Discord updates. We are usually already working on a fix —
            reach out through Contact so we can help you directly.
          </p>
        </div>

        <nav
          className="rounded-2xl border p-4 mb-8"
          style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}
          aria-label="Orion Quest guide topics"
        >
          <p className="text-sm font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Guide
          </p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={(e) => scrollToSection(e, s.id)}
                  className="text-sm hover:underline text-left"
                  style={{ color: C.primary, fontFamily: "Roboto" }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <article className="rounded-2xl border p-5 sm:p-8 space-y-8 mb-8" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <section id="oq-about" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              About Orion Quest
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Orion Quest is a community tool that helps members automatically obtain Discord Quests.
              We share it to foster a more active community and to help every member become a Nitro
              user equipped with the full 3PC profile set.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Orion Quest contains absolutely no malicious code and does not steal any personal user
              information.
            </p>
          </section>

          <section id="oq-using" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              How to Use
            </h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Install Orion Quest, then follow these steps in the Discord app:
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-sm mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Launch the Discord app.</li>
              <li>
                Press <strong style={{ color: C.onSurface }}>Ctrl+Shift+I</strong> on your keyboard to
                open Developer Tools.
              </li>
              <li>
                Open the <strong style={{ color: C.onSurface }}>Console</strong> tab.
              </li>
              <li>
                Paste the contents of the <strong style={{ color: C.onSurface }}>OrionQuest.js</strong>{" "}
                file into the console input field.
              </li>
              <li>
                If pasting fails, type the following command first, then try pasting again:
                <code
                  className="block mt-2 text-xs px-3 py-2 rounded font-mono"
                  style={{ background: C.surfaceVar, color: C.onSurface }}
                >
                  allow pasting
                </code>
              </li>
              <li>After pasting, the quest auto-completion modal will open.</li>
            </ol>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              The usage method is simple — you can learn the rest on your own from the modal.
            </p>
          </section>

          <section id="oq-browser" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Using in Browser
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You can also run Orion Quest directly in your browser without installing the Discord app.
              Open discord.com, press <strong style={{ color: C.onSurface }}>Ctrl+Shift+I</strong>, go
              to the Console tab, and paste <strong style={{ color: C.onSurface }}>OrionQuest.js</strong>{" "}
              the same way.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Because of the browser&apos;s limited functionality, you can only watch videos within a
              quest — you cannot play games.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              To complete all quests, you must use Orion Quest in the Discord desktop app.
            </p>
          </section>

          <section id="oq-rewards" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Rewards &amp; Profile
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              With the rewards obtained through quests, you can purchase Nitro and beautifully decorate
              your profile — including nameplates and avatar decorations — to unlock the full 3PC
              profile look.
            </p>
          </section>

          <section id="oq-roadmap" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Coming Soon
            </h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Plugins for Linux, Mac, and mobile will also be completed in the future.
            </p>
          </section>

          <section id="oq-support" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Support
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              For support or any questions, use our official support channel via Contact. Please use
              that channel instead of leaving a negative review when something breaks.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Support URL:{" "}
              <button
                type="button"
                onClick={() => setPage?.("contact")}
                className="hover:underline"
                style={{ color: C.primary, fontFamily: "Roboto" }}
              >
                https://ninjaera.up.railway.app/#/contact
              </button>
            </p>
          </section>

          <section id="oq-privacy" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Privacy Practices
            </h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>We respect your privacy.</li>
              <li>Orion Quest does not steal personal user information and contains no malicious code.</li>
              <li>We are not affiliated with Discord in any way.</li>
            </ul>
          </section>
        </article>

        {setPage && (
          <div
            className="rounded-2xl border border-dashed p-6 text-center"
            style={{ background: C.surfaceVar, borderColor: C.outlineVar }}
          >
            <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Need help with Orion Quest? Reach our support channel through Contact.
            </p>
            <FilledBtn onClick={() => setPage("contact")} cls="justify-center mx-auto">
              Open Contact / Support
            </FilledBtn>
          </div>
        )}
      </div>
    </div>
  );
}

export default OrionQuestPage;
