import type { MouseEvent } from "react";
import { useEffect } from "react";
import { useC, SH1, FilledBtn, type Page } from "@/app/shared";
import { registerAppInstallationSilent } from "@/shared/appInstallRegistration";

const SECTIONS = [
  { id: "oq-about", title: "About Orion Quest" },
  { id: "oq-using", title: "How to Use" },
  { id: "oq-quests", title: "Discord Quests" },
  { id: "oq-plugins", title: "Plugins & Styles" },
  { id: "oq-browser", title: "Browser Setup" },
  { id: "oq-desktop", title: "Desktop Setup" },
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
    document.title = "Orion Quest · Ninja Era";
    void registerAppInstallationSilent({
      appId: "orion-quest",
      appName: "Orion Quest",
      defaultVersion: "1.0.0",
    });
    return () => {
      document.title = "Ninja Era";
    };
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
            OrionQuest is a modification for discord.com that adds plugins and custom styles,
            blocks Discord&apos;s tracking and more! Usage is the same as Vencord — if you already
            know Vencord, you already know Orion Quest.
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
            Temporary breakages happen when Discord or browser stores update. We are usually already
            working on a fix — reach out through Contact so we can help you directly.
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
              It is built on the same workflow as Vencord so setup and day-to-day use feel familiar.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We share this tool to foster a more active community and to help every member become a
              Nitro user equipped with the full 3PC profile set.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Orion Quest contains absolutely no malicious code and does not steal any personal user
              information. It is privacy-friendly by design and blocks Discord analytics &amp; crash
              reporting out of the box.
            </p>
          </section>

          <section id="oq-using" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              How to Use
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Because you already have Orion Quest installed, open Discord (desktop or browser) and
              follow the same steps you would with Vencord:
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-sm mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Click the gear icon next to your username to open <strong style={{ color: C.onSurface }}>User Settings</strong>.</li>
              <li>Scroll the sidebar until you see the <strong style={{ color: C.onSurface }}>Orion Quest</strong> / Vencord-style settings section.</li>
              <li>Open <strong style={{ color: C.onSurface }}>Plugins</strong> to browse built-in plugins.</li>
              <li>Search for the plugin you need and enable the toggle beside it.</li>
              <li>If Discord asks you to restart, click <strong style={{ color: C.onSurface }}>Restart</strong>.</li>
              <li>To configure a plugin, return to Plugins and click the cog icon next to it.</li>
            </ol>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Optional settings sync keeps plugins and options aligned across devices when enabled.
            </p>
          </section>

          <section id="oq-quests" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Discord Quests
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Orion Quest includes plugins that help you complete Discord Quests automatically so you
              can unlock Nitro rewards and profile cosmetics more easily.
            </p>
            <ol className="list-decimal pl-5 space-y-2 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Open User Settings → Plugins.</li>
              <li>Enable the Discord Quests / Orion Quest related plugin(s).</li>
              <li>Restart Discord if prompted.</li>
              <li>Open Discord&apos;s Quests UI (Gift Inventory / Quests) and start an available quest.</li>
              <li>Let the plugin handle progress while you stay signed in as usual.</li>
            </ol>
          </section>

          <section id="oq-plugins" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Plugins &amp; Styles
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Like Vencord, Orion Quest ships with a large set of built-in plugins plus an inbuilt
              CSS editor. You can import custom styles (including BetterDiscord-compatible themes).
            </p>
            <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Works on Discord Stable, Canary, and PTB</li>
              <li>Excellent browser support via extension or UserScript</li>
              <li>Custom CSS and theme imports</li>
              <li>Privacy-friendly defaults (no telemetry from Orion Quest)</li>
            </ul>
          </section>

          <section id="oq-browser" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Browser Setup
            </h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Prefer discord.com in a browser? Install Orion Quest the same way you would install
              Vencord for the web.
            </p>
            <h3 className="text-base font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Chromium (Chrome, Edge, Brave, Opera…)
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Install the browser extension from the store link provided with your install package.</li>
              <li>Alternatively, install a UserScript manager (Violentmonkey or Tampermonkey), then open the Orion Quest <code className="text-xs px-1 rounded" style={{ background: C.surfaceVar }}>.user.js</code> link so the manager prompts you to install it.</li>
              <li>Open discord.com, go to User Settings, and confirm the Orion Quest section appears.</li>
            </ol>
            <h3 className="text-base font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Firefox
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Install Tampermonkey from the Firefox Add-ons store (other managers are unreliable on Firefox).</li>
              <li>Open the Orion Quest UserScript link; Tampermonkey should prompt you to install it.</li>
              <li>Open discord.com and verify Orion Quest settings appear.</li>
            </ol>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Note: Due to Discord&apos;s content security policy, the CSS Editor, custom themes, and
              plugins that load external scripts may not work with the UserScript. Prefer the
              extension when available. Safari is not supported — use another browser for Orion Quest Web.
            </p>
          </section>

          <section id="oq-desktop" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Desktop Setup
            </h2>
            <p className="text-sm leading-relaxed mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Desktop install mirrors the official Vencord installer flow.
            </p>
            <h3 className="text-base font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Windows
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Run the Orion Quest / Vencord-style installer executable.</li>
              <li>Pick the Discord install you want to patch (Stable, Canary, or PTB).</li>
              <li>Press Install. Do not run the installer as Administrator.</li>
              <li>If Windows shows a SmartScreen warning, choose More info → Run anyway (unsigned apps are common for client mods).</li>
              <li>Restart Discord and confirm Orion Quest appears under User Settings.</li>
            </ol>
            <h3 className="text-base font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              macOS
            </h3>
            <ol className="list-decimal pl-5 space-y-1.5 text-sm mb-3" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Unzip the installer and open the app.</li>
              <li>Select your Discord install and press Install.</li>
              <li>If macOS blocks the app, right-click → Open, or allow it in System Settings.</li>
              <li>Restart Discord and verify Orion Quest settings.</li>
            </ol>
            <h3 className="text-base font-medium mb-1" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Linux
            </h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Open a terminal and run the install script provided with your package (same pattern as
              Vencord&apos;s <code className="text-xs px-1 rounded" style={{ background: C.surfaceVar }}>install.sh</code>). Discord installed via snap is not supported — use Flatpak or the official .deb instead.
            </p>
          </section>

          <section id="oq-support" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              Support
            </h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              For support or any questions, join our official support channel via Contact on the
              Ninja Era site. Please use that channel instead of leaving a negative review when
              something breaks.
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
              <li>Tracking blockers help limit Discord analytics and crash reporting by default.</li>
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
