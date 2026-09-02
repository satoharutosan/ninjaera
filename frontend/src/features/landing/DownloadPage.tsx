import { useC, SH1, type Page } from "@/app/shared";
import { GameDownloadGrid } from "@/features/landing/GameDownloadGrid";

function DownloadPage({ setPage }: { setPage: (p: Page) => void }) {
  const C = useC();

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-10 text-center">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>
            Official download
          </p>
          <h1 className="text-3xl md:text-4xl font-light mb-4" style={{ color: C.onSurface, fontFamily: "'Trade Winds', cursive" }}>
            Download <span className="font-medium">Ninja Era</span>
          </h1>
          <p className="text-sm leading-relaxed max-w-2xl mx-auto" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Get the official Ninja Era game (NinjaEra) — a free open-world ninja MMORPG and MMO RPG.
            Download Ninja Era for Windows PC, Android, and iOS from the official website at ninjaera.up.railway.app.
          </p>
        </header>

        <GameDownloadGrid />

        <section className="mt-12 rounded-2xl border p-6" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <h2 className="text-lg font-medium mb-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Ninja Era game download — platforms
          </h2>
          <ul className="text-sm space-y-2 list-disc pl-5" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            <li><strong>Ninja Era download for Windows</strong> — full PC client for Win 10/11</li>
            <li><strong>Ninja Era download for Android</strong> — mobile ninja MMO on Android 9+</li>
            <li><strong>Ninja Era download for iOS</strong> — iPhone and iPad (iOS 15+)</li>
          </ul>
          <p className="text-sm mt-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            New to Ninja Era?{" "}
            <button type="button" className="underline" style={{ color: C.primary }} onClick={() => setPage("signup")}>
              Create a free account
            </button>{" "}
            or return to the{" "}
            <button type="button" className="underline" style={{ color: C.primary }} onClick={() => setPage("home")}>
              home page
            </button>.
          </p>
        </section>
      </div>
    </div>
  );
}

export default DownloadPage;
