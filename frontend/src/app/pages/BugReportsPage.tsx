import { useEffect } from "react";
import { useC, SH1, FilledBtn, type Page } from "@/app/shared";

function BugReportsPage({ setPage }: { setPage: (p: Page) => void }) {
  const C = useC();

  useEffect(() => {
    document.title = "Bug Reports · Ninja Era";
    return () => { document.title = "Ninja Era"; };
  }, []);

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Support</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Bug Reports</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Help us improve Ninja Era by reporting clear, reproducible issues.
          </p>
        </header>

        <article className="rounded-2xl border p-5 sm:p-8 space-y-6 mb-6" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <section>
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>How to report a bug</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Use Contact for now, or email the team. A dedicated ticket system will plug into this page later without changing the layout.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>What to include</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Short summary of the problem</li>
              <li>Expected vs. actual behavior</li>
              <li>Step-by-step reproduction steps</li>
              <li>When it started (approximate date/time)</li>
              <li>Whether it happens every time or intermittently</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Screenshots & media</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Attach screenshots or a short screen recording when possible. Blur private information (emails, tokens, other users&apos; messages) before sharing.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Browser & device information</h2>
            <ul className="list-disc pl-5 space-y-1.5 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Browser name and version (Chrome, Firefox, Safari, Edge…)</li>
              <li>Operating system (Windows, macOS, Android, iOS…)</li>
              <li>Desktop or mobile viewport</li>
              <li>If the issue is in-game: client platform and build version</li>
            </ul>
          </section>
        </article>

        <div
          className="rounded-2xl border border-dashed p-6 text-center"
          style={{ background: C.surfaceVar, borderColor: C.outlineVar }}
        >
          <p className="text-sm mb-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Ticket submission will appear here. Until then, send details through Contact.
          </p>
          <FilledBtn onClick={() => setPage("contact")} cls="justify-center mx-auto">
            Open Contact Form
          </FilledBtn>
        </div>
      </div>
    </div>
  );
}

export default BugReportsPage;
