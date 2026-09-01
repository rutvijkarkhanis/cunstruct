import type { ReactNode } from "react";
import Header from "@/components/Header";
import SEO from "@/components/SEO";

// ── Edit these once with your real details ───────────────────────────────────
// (Meta needs a real, complete policy — replace the contact email / add your
//  registered name & address before you rely on this in ads.)
const COMPANY = "Cunstruct";
const LEGAL_NAME = "";                       // optional registered entity, e.g. "Cunstruct Technologies Pvt. Ltd."
const CONTACT_EMAIL = "privacy@cunstruct.com"; // ← update to a monitored address
const ADDRESS = "";                          // optional postal address
const WEBSITE = "cunstruct.com";
const LAST_UPDATED = "1 September 2026";
// ─────────────────────────────────────────────────────────────────────────────

const entity = LEGAL_NAME || COMPANY;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold text-foreground mt-6">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Privacy() {
  return (
    <div className="min-h-screen bg-background">
      <SEO title="Privacy Policy" description={`How ${COMPANY} collects, uses and protects your personal information.`} />
      <Header />
      <main className="max-w-3xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-foreground">Privacy Policy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Last updated: {LAST_UPDATED}</p>

        <div className="mt-6 space-y-2 text-sm leading-relaxed text-muted-foreground">
          <p>
            This Privacy Policy explains how {entity} (“{COMPANY}”, “we”, “us” or “our”) collects, uses,
            shares and protects your personal information when you interact with us — including through our website
            ({WEBSITE}), our applications, and forms you submit through our advertisements on platforms such as
            Facebook and Instagram (Meta). By providing your information to us, you agree to the practices described
            in this policy.
          </p>
        </div>

        <Section title="1. Information we collect">
          <p>We collect the following categories of information:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Information you give us.</b> When you fill in a contact or enquiry form, request a quotation, or submit
              a lead form through our Facebook/Instagram ads, we collect details such as your name, email address,
              phone number, company or project name, location, and any information you choose to include about your
              project or enquiry.
            </li>
            <li>
              <b>Account &amp; project information.</b> If you use our platform, we collect the information needed to
              provide the service — such as your account details and the project, document and bill-of-quantities data
              you create or upload.
            </li>
            <li>
              <b>Information collected automatically.</b> When you visit our website we may collect usage and device
              information (such as IP address, browser type, pages viewed and referring pages) through cookies and
              similar technologies.
            </li>
            <li>
              <b>Information from third parties.</b> When you submit a lead form on Facebook or Instagram, Meta shares
              the details you entered with us so we can respond to your enquiry.
            </li>
          </ul>
        </Section>

        <Section title="2. How we use your information">
          <ul className="list-disc pl-5 space-y-1">
            <li>To respond to your enquiries and contact you about your request (including by phone, email or WhatsApp).</li>
            <li>To prepare and share quotations, estimates and bills of quantities.</li>
            <li>To provide, operate, maintain and improve our website and services.</li>
            <li>To send service-related communications and, where you have consented, marketing communications.</li>
            <li>To keep records, prevent fraud and misuse, and comply with our legal obligations.</li>
          </ul>
        </Section>

        <Section title="3. Legal bases">
          <p>
            Where applicable law requires a legal basis for processing, we rely on your consent (for example, when you
            submit a lead form or opt in to marketing), the performance of a contract with you, our legitimate
            interests in operating and improving our business, and compliance with legal obligations. You may withdraw
            consent at any time (see “Your rights”).
          </p>
        </Section>

        <Section title="4. How we share your information">
          <p>We do not sell your personal information. We share it only as described here:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <b>Service providers.</b> With vendors who process data on our behalf — for example, hosting and database
              providers, messaging/communication providers, and analytics providers — under agreements that require
              them to protect it.
            </li>
            <li>
              <b>Advertising platforms.</b> When you interact with our ads, Meta processes your information in
              accordance with its own policies. We use the lead information Meta provides only to contact you and
              respond to your enquiry.
            </li>
            <li>
              <b>Legal &amp; safety.</b> Where required by law, regulation, legal process, or to protect our rights,
              property or safety, or that of others.
            </li>
            <li>
              <b>Business transfers.</b> In connection with a merger, acquisition or sale of assets, subject to this
              policy.
            </li>
          </ul>
        </Section>

        <Section title="5. Cookies and tracking technologies">
          <p>
            We use cookies and similar technologies to operate our website, remember your preferences, measure
            performance and — where you consent — to measure and improve our advertising, including the Meta Pixel and
            similar tools. You can control cookies through your browser settings; disabling some cookies may affect how
            the site works.
          </p>
        </Section>

        <Section title="6. Data retention">
          <p>
            We keep personal information for as long as needed to fulfil the purposes described in this policy — for
            example, to respond to and follow up on your enquiry, provide our services, and meet legal, accounting or
            reporting requirements — after which we delete or anonymise it.
          </p>
        </Section>

        <Section title="7. International transfers">
          <p>
            Your information may be processed in countries other than your own, including where our service providers
            operate. Where we transfer personal information across borders, we take steps to ensure it remains
            protected consistent with this policy and applicable law.
          </p>
        </Section>

        <Section title="8. Data security">
          <p>
            We use reasonable technical and organisational measures designed to protect personal information against
            unauthorised access, loss, misuse or alteration. No method of transmission or storage is completely secure,
            so we cannot guarantee absolute security.
          </p>
        </Section>

        <Section title="9. Your rights and choices">
          <p>Depending on your location, you may have the right to:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Access, correct or update the personal information we hold about you.</li>
            <li>Request deletion of your personal information.</li>
            <li>Withdraw consent or object to certain processing, including direct marketing.</li>
            <li>Opt out of marketing communications at any time (for example, via an unsubscribe link or by contacting us).</li>
          </ul>
          <p>
            To exercise any of these rights, contact us using the details below. We will respond in accordance with
            applicable law.
          </p>
        </Section>

        <Section title="10. Children’s privacy">
          <p>
            Our website and services are not directed to children, and we do not knowingly collect personal
            information from children. If you believe a child has provided us with personal information, please contact
            us and we will take appropriate steps to delete it.
          </p>
        </Section>

        <Section title="11. Third-party links">
          <p>
            Our website and ads may link to third-party sites and services that we do not control. This policy does not
            apply to those third parties; please review their privacy policies.
          </p>
        </Section>

        <Section title="12. Changes to this policy">
          <p>
            We may update this Privacy Policy from time to time. We will post the updated version here with a revised
            “Last updated” date. Material changes will be communicated as required by law.
          </p>
        </Section>

        <Section title="13. Contact us">
          <p>If you have questions about this policy or your personal information, contact us at:</p>
          <p className="text-foreground">
            {entity}<br />
            <a className="text-primary underline" href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>
            {ADDRESS ? <><br />{ADDRESS}</> : null}
          </p>
        </Section>
      </main>
    </div>
  );
}
