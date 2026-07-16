import { useC, SH1, type Page } from "@/app/shared";
import { LegalReviewActions } from "@/features/auth/LegalReviewActions";

const SECTIONS = [
  { id: "overview", title: "1. Overview" },
  { id: "collect", title: "2. Information We Collect" },
  { id: "use", title: "3. How We Use Information" },
  { id: "share", title: "4. Sharing" },
  { id: "retention", title: "5. Retention & Security" },
  { id: "rights", title: "6. Your Choices" },
  { id: "children", title: "7. Children" },
  { id: "changes", title: "8. Changes" },
  { id: "contact", title: "9. Contact" },
] as const;

function PrivacyPolicyPage({ setPage }: { setPage?: (p: Page) => void }) {
  const C = useC();

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Legal</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Privacy Policy</h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Last updated: July 16, 2026 · Ninja Era / Plantend platform
          </p>
        </header>

        <nav className="rounded-2xl border p-4 mb-8 print:hidden" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }} aria-label="Table of contents">
          <p className="text-sm font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Contents</p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="text-sm hover:underline" style={{ color: C.primary, fontFamily: "Roboto" }}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>

        <article className="rounded-2xl border p-5 sm:p-8 space-y-8" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <section id="overview">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>1. Overview</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              This Privacy Policy explains how Ninja Era Studio (“we”, “us”) collects, uses, and protects information when you use the Ninja Era website and related services (the “Service”). By creating an account or using the Service, you acknowledge this policy.
            </p>
          </section>

          <section id="collect">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>2. Information We Collect</h2>
            <ul className="list-disc pl-5 space-y-1 text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Account details such as email address, username, and authentication data</li>
              <li>Profile information you choose to provide (bio, avatar, location fields)</li>
              <li>Messages, uploads, and other content you submit on the platform</li>
              <li>Technical and security logs (IP address, approximate location, device/browser metadata)</li>
              <li>OAuth provider identifiers when you sign in with Google, GitHub, or Discord</li>
            </ul>
          </section>

          <section id="use">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>3. How We Use Information</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We use information to operate accounts, deliver verification and transactional email, provide messaging and community features, prevent abuse, improve reliability, and comply with legal obligations. Email addresses are used to verify ownership during registration and for essential account notices.
            </p>
          </section>

          <section id="share">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>4. Sharing</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We do not sell personal information. We may share data with service providers who help us run the Service (for example, hosting or email delivery), when required by law, or to protect the safety and integrity of the platform and its users. OAuth sign-in shares limited profile data as authorized by the provider you choose.
            </p>
          </section>

          <section id="retention">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>5. Retention & Security</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We retain account and operational data for as long as needed to provide the Service and meet security, legal, and administrative requirements. Pending registration verification data is removed after expiry or successful verification. We apply reasonable technical and organizational measures to protect information, but no method of transmission or storage is perfectly secure.
            </p>
          </section>

          <section id="rights">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>6. Your Choices</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You may update profile information in your account settings, and you may contact us to request account-related assistance. Depending on where you live, you may have additional rights regarding access or deletion of personal data.
            </p>
          </section>

          <section id="children">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>7. Children</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              The Service is not directed to children under the age required to consent to online services in their jurisdiction. If you believe a child has provided us personal information inappropriately, contact us so we can take appropriate action.
            </p>
          </section>

          <section id="changes">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>8. Changes</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may update this Privacy Policy from time to time. Material changes will be reflected by updating the “Last updated” date on this page.
            </p>
          </section>

          <section id="contact">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>9. Contact</h2>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Privacy questions may be submitted through the Contact page on the Ninja Era website, or by emailing{" "}
              <a href="mailto:support@ninjaera.com" className="underline" style={{ color: C.primary }}>support@ninjaera.com</a>.
            </p>
          </section>

          {setPage && <LegalReviewActions setPage={setPage} documentLabel="Privacy Policy" />}
        </article>
      </div>
    </div>
  );
}

export default PrivacyPolicyPage;
