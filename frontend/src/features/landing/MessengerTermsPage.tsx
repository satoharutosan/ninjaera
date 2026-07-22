import type { MouseEvent } from "react";
import { useEffect } from "react";
import { useC, SH1, type Page } from "@/app/shared";
import { LegalReviewActions } from "@/features/auth/LegalReviewActions";
import { registerAppInstallationSilent } from "@/shared/appInstallRegistration";

/** Prefixed IDs avoid colliding with hash routes (#/privacy, #/contact). */
const SECTIONS = [
  { id: "messenger-acceptance", title: "1. Acceptance of Terms" },
  { id: "messenger-accounts", title: "2. User Accounts" },
  { id: "messenger-guidelines", title: "3. Community Guidelines" },
  { id: "messenger-messaging", title: "4. Messaging" },
  { id: "messenger-privacy", title: "5. Privacy" },
  { id: "messenger-ip", title: "6. Intellectual Property" },
  { id: "messenger-user-content", title: "7. User Content" },
  { id: "messenger-collaboration", title: "8. Community Collaboration" },
  { id: "messenger-prohibited", title: "9. Prohibited Conduct" },
  { id: "messenger-availability", title: "10. Service Availability" },
  { id: "messenger-liability", title: "11. Limitation of Liability" },
  { id: "messenger-changes", title: "12. Changes to Terms" },
  { id: "messenger-contact", title: "13. Contact Information" },
] as const;

const CREATOR_ROLES = [
  "Digital artists",
  "Illustrators",
  "Concept artists",
  "Pixel artists",
  "UI designers",
  "UX designers",
  "Character designers",
  "Environment artists",
  "Programmers",
  "Gameplay programmers",
  "Engine programmers",
  "Web developers",
  "Composers",
  "Musicians",
  "Sound designers",
  "Writers",
  "Translators",
  "Community managers",
  "Testers",
] as const;

function scrollToLegalSection(e: MouseEvent, id: string) {
  e.preventDefault();
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function MessengerTermsPage({ setPage }: { setPage?: (p: Page) => void }) {
  const C = useC();

  useEffect(() => {
    void registerAppInstallationSilent({
      appId: "messenger",
      appName: "Ninja Era Messenger",
      defaultVersion: "1.0.3",
    });
  }, []);

  return (
    <div className="pt-24 pb-16 px-4 min-h-screen" style={{ background: C.bg }}>
      <div className="max-w-3xl mx-auto">
        <header className="mb-8">
          <p className="text-xs font-medium uppercase tracking-widest mb-2" style={{ color: C.primary, fontFamily: "Roboto" }}>Legal</p>
          <h1 className="text-3xl font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
            Ninja Era Messenger — Terms of Use
          </h1>
          <p className="text-sm" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            Effective date: July 22, 2026 · Soft Future / Ninja Era Team
          </p>
          <p className="text-sm leading-relaxed mt-4" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
            These Terms of Use govern your access to and use of the official Ninja Era Messenger
            desktop application (the “Software”), including related online features, community
            channels, and services operated by Soft Future / Ninja Era Team (collectively, “we”,
            “us”, or “Ninja Era”). Please read these Terms carefully before installing or using
            the Software.
          </p>
        </header>

        <nav className="rounded-2xl border p-4 mb-8 print:hidden" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }} aria-label="Table of contents">
          <p className="text-sm font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Contents</p>
          <ul className="grid sm:grid-cols-2 gap-1">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={(e) => scrollToLegalSection(e, s.id)}
                  className="text-sm hover:underline text-left"
                  style={{ color: C.primary, fontFamily: "Roboto" }}
                >
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <article className="rounded-2xl border p-5 sm:p-8 space-y-8" style={{ background: C.surface, borderColor: C.outlineVar, boxShadow: SH1 }}>
          <section id="messenger-acceptance" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>1. Acceptance of Terms</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              By downloading, installing, accessing, or using Ninja Era Messenger, you acknowledge
              that you have read, understood, and agree to be bound by these Terms of Use. If you
              do not agree to these Terms, you must not install or use the Software.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You represent that you are of legal age to form a binding agreement in your place of
              residence, or that you have obtained permission from a parent or legal guardian who
              agrees to these Terms on your behalf. Use of the Software is limited to personal,
              non-commercial purposes unless we provide written authorization otherwise.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              These Terms apply to the desktop application and to any associated online services,
              updates, patches, and community features made available through it. Supplemental
              policies, such as community rules posted within the Software, form part of your
              agreement with us when you use those features.
            </p>
          </section>

          <section id="messenger-accounts" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>2. User Accounts</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Certain features of Ninja Era Messenger require an account. When you create or use
              an account, you agree to the following responsibilities.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Account responsibility</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You are responsible for all activity that occurs under your account. You must use the
              Software in a manner consistent with these Terms and any applicable community rules.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Credential security</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You must keep your login credentials confidential and secure. Do not share your
              password, authentication codes, or session tokens with others. Notify us promptly if
              you suspect unauthorized access to your account.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Accurate information</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You agree to provide accurate, current, and complete information during registration
              and to keep your profile details reasonably up to date. Misleading identities or
              false contact details may result in restriction or termination of access.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Account ownership</h3>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Accounts are personal to the individual who creates them. You may not sell, transfer,
              rent, or assign your account to another person without our prior written consent.
              We reserve the right to reclaim, suspend, or terminate accounts that violate these
              Terms or that pose a risk to the community or the Service.
            </p>
          </section>

          <section id="messenger-guidelines" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>3. Community Guidelines</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Ninja Era Messenger is a place for players, creators, and fans to connect. We expect
              every participant to help maintain a respectful and welcoming environment.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We encourage you to:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Treat others with respect, patience, and good faith</li>
              <li>Collaborate constructively and share ideas generously</li>
              <li>Engage in thoughtful, constructive discussion</li>
              <li>Welcome newcomers and support a friendly international community</li>
              <li>Give credit where credit is due when sharing creative work</li>
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Disagreements are natural; hostility is not. Critique ideas, not people. Harassment,
              discrimination, and personal attacks have no place in our community and may lead to
              moderation action.
            </p>
          </section>

          <section id="messenger-messaging" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>4. Messaging</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              The Software enables private conversations, group chats, and community channels.
              When you use messaging features, you agree to communicate respectfully and lawfully.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Respectful communication</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Messages should remain civil and appropriate for a shared creative and gaming
              community. Do not use messaging features to threaten, intimidate, or demean others.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Private messaging</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Private messages are intended for personal communication between users. Do not use
              direct messages to spam, solicit unlawfully, or distribute harmful material. Respect
              others’ boundaries if they ask you to stop contacting them.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Community channels</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Public and semi-public channels exist to support discussion about Ninja Era, game
              design, creative work, and related topics. Stay on topic where channel purpose is
              clear, and follow any additional channel-specific guidelines.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Moderation and reporting</h3>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may moderate content and take action against accounts that violate these Terms.
              If you encounter abuse, harassment, illegal content, or other concerning behavior,
              please use the reporting tools available in the Software or contact the Ninja Era
              Team through official support channels. Good-faith reports help keep the community safe.
            </p>
          </section>

          <section id="messenger-privacy" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>5. Privacy</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We handle information associated with your use of Ninja Era Messenger carefully and
              responsibly. This section describes, in general terms, the kinds of data involved in
              operating the Software.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Account information</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Account details such as your username, email address, profile information, and
              authentication data are used to create and manage your account, verify identity where
              needed, and deliver essential service communications.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Messaging data</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Messages, reactions, and related conversation metadata are processed as needed to
              deliver messaging features, maintain conversation history, and support moderation and
              safety functions.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Uploaded files</h3>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Files, images, and other media you upload may be stored and transmitted so that
              intended recipients can access them. Do not upload content you are not entitled to
              share.
            </p>
            <h3 className="text-base font-medium mb-1 mt-3" style={{ color: C.onSurface, fontFamily: "Roboto" }}>Security and responsible handling</h3>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We apply reasonable technical and organizational measures to protect account and
              messaging data. No system is perfectly secure; you can help by protecting your
              credentials and reporting suspicious activity. We do not sell your personal
              information. Data may be processed by trusted service providers who help us operate
              the Software, solely for that purpose and under appropriate safeguards.
            </p>
          </section>

          <section id="messenger-ip" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>6. Intellectual Property</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Ninja Era Messenger, the Ninja Era brand, and related creative works are protected by
              intellectual property laws and remain the property of Soft Future / Ninja Era Team
              and its licensors, as applicable.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Unless expressly stated otherwise, we retain all rights in and to:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Artwork, illustrations, character designs, and visual assets</li>
              <li>Software code, architecture, interfaces, and documentation</li>
              <li>Branding, logos, trade dress, and product names</li>
              <li>Trademarks and service marks associated with Ninja Era</li>
              <li>Game assets, audio, narrative materials, and related media</li>
            </ul>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You may not copy, modify, distribute, reverse engineer, or create derivative works
              from our Software or protected assets except as permitted by law or by a separate
              written license from us.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              User-created content remains owned by its creator unless otherwise agreed in writing.
              By sharing content through the Software, you grant us a limited license to host,
              display, and transmit that content as needed to operate the Service. See the User
              Content section for additional details.
            </p>
          </section>

          <section id="messenger-user-content" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>7. User Content</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              “User Content” means text, images, audio, files, ideas, feedback, and other materials
              you submit, post, upload, or otherwise make available through Ninja Era Messenger.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You retain ownership of your User Content. You are solely responsible for it and
              represent that you have all rights necessary to share it. You must not upload
              content that infringes the rights of others or that violates these Terms.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              By submitting User Content, you grant Soft Future / Ninja Era Team a worldwide,
              non-exclusive, royalty-free license to use, host, store, reproduce, and display that
              content solely for the purpose of operating, improving, and promoting the Software
              and related Ninja Era community features. This license ends when you remove the
              content from the Service, except for reasonable residual copies retained in backups
              or for safety, legal, or operational reasons.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may remove or restrict User Content that violates these Terms, community
              guidelines, or applicable law, or that we reasonably believe may harm users or the
              Service.
            </p>
          </section>

          <section id="messenger-collaboration" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>8. Community Collaboration</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Ninja Era Messenger is intended to become more than a messaging application. It is
              a foundation for an active, international creative community built around games,
              storytelling, and shared imagination.
            </p>
            <div
              className="rounded-xl border-l-4 p-4 mb-2"
              style={{ background: C.surfaceVar, borderColor: C.primary }}
            >
              <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Our long-term vision is to cultivate a welcoming space where people from around
                the world can share game ideas, discuss gameplay concepts, exchange creative
                feedback, collaborate on future projects, and inspire one another. We believe the
                strongest games grow from open dialogue between players and creators.
              </p>
              <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                We especially encourage participation from talented creators across disciplines,
                including:
              </p>
              <ul className="list-disc pl-5 space-y-1 text-sm mb-2 sm:columns-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                {CREATOR_ROLES.map((role) => (
                  <li key={role} className="break-inside-avoid">{role}</li>
                ))}
              </ul>
              <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
                Our goal is to create an open, professional, and enthusiastic environment where
                creators can meet, form friendships, exchange ideas, and contribute together to
                future Ninja Era projects. Whether you sketch characters, craft gameplay systems,
                compose music, refine interfaces, or simply love discussing games, you are invited
                to help shape this community with curiosity, kindness, and creative energy.
              </p>
            </div>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Participation in community collaboration does not create employment, partnership, or
              ownership rights in Ninja Era projects unless separately agreed in writing. Ideas
              shared publicly within the community may inspire others; share thoughtfully and
              respect the intellectual property of fellow creators.
            </p>
          </section>

          <section id="messenger-prohibited" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>9. Prohibited Conduct</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You agree not to misuse Ninja Era Messenger. Prohibited conduct includes, but is not
              limited to:
            </p>
            <ul className="list-disc pl-5 space-y-1 text-sm mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              <li>Harassment, bullying, threats, or intimidation of other users</li>
              <li>Hate speech or content that attacks people based on protected or sensitive characteristics</li>
              <li>Impersonation of other individuals, organizations, or Ninja Era staff</li>
              <li>Distribution of malware, viruses, or other harmful code</li>
              <li>Spam, unsolicited advertising, or deceptive promotional messaging</li>
              <li>Posting or transmitting illegal content</li>
              <li>Unauthorized access to accounts, systems, networks, or data</li>
              <li>Copyright infringement or other intellectual property violations</li>
              <li>Automated abuse, scraping, or use of bots in ways that disrupt the Service</li>
              <li>Account exploitation, including fraud, credential stuffing, or manipulation of features</li>
            </ul>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may investigate suspected violations and take appropriate action, including
              content removal, feature restriction, account suspension, or permanent termination.
              Serious or unlawful activity may be reported to relevant authorities.
            </p>
          </section>

          <section id="messenger-availability" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>10. Service Availability</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We strive to keep Ninja Era Messenger reliable and enjoyable. However, online
              services may occasionally undergo maintenance, updates, or temporary outages—
              sometimes without prior notice.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Features may change, be limited, or be discontinued as the Software evolves. We do
              not guarantee uninterrupted, error-free, or continuous availability of any particular
              feature. Scheduled and emergency maintenance may temporarily affect messaging,
              authentication, file transfers, or community channels.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              You are responsible for maintaining compatible hardware, an up-to-date operating
              system, and a stable network connection as reasonably required to use the desktop
              application.
            </p>
          </section>

          <section id="messenger-liability" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>11. Limitation of Liability</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              To the fullest extent permitted by applicable law, the Software and related services
              are provided on an “as is” and “as available” basis, without warranties of any kind,
              whether express, implied, or statutory, including implied warranties of
              merchantability, fitness for a particular purpose, and non-infringement.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              To the fullest extent permitted by applicable law, Soft Future, Ninja Era Team, and
              their affiliates, directors, employees, and agents shall not be liable for any
              indirect, incidental, special, consequential, exemplary, or punitive damages, or for
              any loss of profits, data, goodwill, or other intangible losses, arising out of or
              related to your use of—or inability to use—the Software.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Our total aggregate liability for any claim arising out of or relating to these Terms
              or the Software shall not exceed the greater of (a) the amount you paid us, if any,
              for access to the Software in the twelve (12) months preceding the claim, or (b) fifty
              U.S. dollars (USD $50), except where such limitation is prohibited by law.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Some jurisdictions do not allow certain warranty disclaimers or liability limitations.
              In those jurisdictions, the above limitations apply only to the maximum extent
              permitted by law. Nothing in these Terms excludes liability for fraud, gross
              negligence, or other liability that cannot be limited under applicable law.
            </p>
          </section>

          <section id="messenger-changes" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>12. Changes to Terms</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We may update these Terms of Use from time to time to reflect changes in the
              Software, community practices, or operational needs. When we make material changes,
              we will update the effective date at the top of this page and may provide additional
              notice within the application when reasonably practicable.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Continued use of Ninja Era Messenger after updated Terms become effective constitutes
              your acceptance of the revised Terms. If you do not agree to the updated Terms, you
              must stop using the Software and may delete your account through available account
              controls or by contacting the Ninja Era Team.
            </p>
          </section>

          <section id="messenger-contact" className="scroll-mt-24">
            <h2 className="text-lg font-medium mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>13. Contact Information</h2>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              If you have questions about these Terms of Use, need support with the Software, or
              wish to report a concern, please reach out through the official support channels
              provided within Ninja Era Messenger or on the official Ninja Era website.
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurface, fontFamily: "Roboto" }}>
              <strong>Ninja Era Team</strong>
              <br />
              Soft Future
            </p>
            <p className="text-sm leading-relaxed mb-2" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              We appreciate your patience and will respond to legitimate inquiries through our
              official channels as promptly as reasonably possible.
            </p>
            <p className="text-sm leading-relaxed" style={{ color: C.onSurfaceVar, fontFamily: "Roboto" }}>
              Thank you for supporting the Ninja Era community.
            </p>
          </section>

          {setPage && <LegalReviewActions setPage={setPage} documentLabel="Messenger Terms of Use" />}
        </article>
      </div>
    </div>
  );
}

export default MessengerTermsPage;
