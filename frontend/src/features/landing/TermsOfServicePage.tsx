import { useEffect } from "react";
import { useC, SH1, type Page } from "@/app/shared";
import { api } from "@/app/api";
import { LegalReviewActions } from "@/features/auth/LegalReviewActions";

const SECTIONS = [
  { id: "acceptance", title: "1. Acceptance of Terms" },
  { id: "accounts", title: "2. Accounts & Eligibility" },
  { id: "conduct", title: "3. Acceptable Use" },
  { id: "content", title: "4. User Content" },
  { id: "services", title: "5. Services & Availability" },
  { id: "privacy", title: "6. Privacy" },
  { id: "termination", title: "7. Suspension & Termination" },
  { id: "liability", title: "8. Disclaimers & Liability" },
  { id: "changes", title: "9. Changes to These Terms" },
  { id: "contact", title: "10. Contact" },
] as const;

function TermsOfServicePage({ setPage }: { setPage?: (p: Page) => void }) {
  const C = useC();

  useEffect(() => {
    api.legal.viewTerms().catch(() => {});
  }, []);

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Legal</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Terms of Service</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Last updated: July 15, 2026 · Ninja Era / Plantend platform
          </p>
        </header>

        <nav className="rounded-2xl border p-4 mb-8 print:hidden" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }} aria-label="Table of contents">
          <p className="text-sm font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Contents</p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {SECTIONS.map(s => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm hover:underline" style={{ color: C.primary, fontFamily: "Roboto" }}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="rounded-2xl border p-5 sm:p-8 space-y-8" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <section id="acceptance">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>1. Acceptance of Terms</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              By accessing or using Ninja Era (the “Service”), you agree to these Terms of Service. If you do not agree, do not use the Service. These terms form a binding agreement between you and Ninja Era Studio.
            </p>
          </section>

          <section id="accounts">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>2. Accounts & Eligibility</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You must provide accurate registration information and keep your credentials secure. You are responsible for activity under your account. You must be old enough under applicable law to form a binding contract. Accounts may require verification or administrator approval for certain features (for example, team membership or resource downloads).
            </p>
          </section>

          <section id="conduct">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>3. Acceptable Use</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You agree not to misuse the Service. Prohibited conduct includes, without limitation:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Harassment, hate speech, threats, or illegal content</li>
              <li>Impersonation, fraud, or unauthorized access to other accounts</li>
              <li>Spam, malware distribution, or intentional disruption of services</li>
              <li>Scraping or automated abuse that harms platform stability</li>
              <li>Violating intellectual property or privacy rights of others</li>
            </ul>
          </section>

          <section id="content">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>4. User Content</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You retain ownership of content you post (messages, images, applications, and similar). By posting, you grant Ninja Era a limited license to host, display, and process that content as needed to operate the Service. You represent that you have the rights to share such content. We may remove content that violates these terms or applicable law.
            </p>
          </section>

          <section id="services">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>5. Services & Availability</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              The Service may change, pause, or end features over time. Scheduled maintenance and unexpected outages may occur. Game downloads, messaging, teamwork applications, and other modules are provided as available and may require eligibility.
            </p>
          </section>

          <section id="privacy">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>6. Privacy</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Use of the Service is also governed by our Privacy Policy. We process account, messaging, and operational logs (including IP and approximate location where collected) to provide security, administration, and product functionality.
            </p>
          </section>

          <section id="termination">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>7. Suspension & Termination</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may suspend or terminate access for violations of these terms, legal requirements, or risk to the platform or other users. You may stop using the Service at any time. Certain provisions (including liability limitations) survive termination.
            </p>
          </section>

          <section id="liability">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>8. Disclaimers & Liability</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              The Service is provided “as is” without warranties of uninterrupted or error-free operation to the fullest extent permitted by law. To the maximum extent allowed, Ninja Era Studio is not liable for indirect, incidental, or consequential damages arising from your use of the Service. Some jurisdictions do not allow certain limitations; in those cases, liability is limited to the greatest extent permitted.
            </p>
          </section>

          <section id="changes">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>9. Changes to These Terms</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may update these Terms of Service. Material changes will be reflected by updating the “Last updated” date on this page. Continued use after changes constitutes acceptance of the revised terms.
            </p>
          </section>

          <section id="contact">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>10. Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Questions about these Terms may be submitted through the Contact page on the Ninja Era website. For account or safety concerns, include enough detail for our team to investigate.
            </p>
          </section>

          {setPage && <LegalReviewActions setPage={setPage} documentLabel="Terms of Service" />}
        </article>
      </div>
    </div>
  );
}

export default TermsOfServicePage;
