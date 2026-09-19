// Public legal pages — reachable by guests at #privacy, #terms and #accessibility
// (hash-routed from App.jsx, same pattern as the event ticket pages).
//
// These are practical starter documents, not legal advice — have them reviewed
// before relying on them formally.

const emerald = '#0b3d2e'
const gold = '#c9a227'
const cream = '#f6f3ea'
const ivory = '#fffdf8'
const ink = '#232323'
const muted = '#767066'
const rule = '#e4ddc9'
const serif = "'Iowan Old Style', 'Georgia', 'Times New Roman', serif"
const sans = "'Inter', -apple-system, 'Helvetica Neue', Arial, sans-serif"

const LAST_UPDATED = '19 September 2026'
const CONTACT_EMAIL = 'bookings@kingsarkdance.com'

const LEGAL_CONTENT = {
  privacy: {
    title: 'Privacy Policy',
    intro: `King's Ark Dance Academy ("KADA", "we", "us") respects your privacy. This policy explains what personal data we collect through kingsarkdance.com, why we collect it, and the rights you have over it.`,
    sections: [
      {
        heading: 'Who we are',
        paragraphs: [
          `King's Ark Dance Academy, 395 College Rd, Birmingham B44 0HF. You can reach us at ${CONTACT_EMAIL} or +44 7535 897732. For the purposes of UK data protection law (UK GDPR and the Data Protection Act 2018), we are the data controller.`,
        ],
      },
      {
        heading: 'What we collect',
        paragraphs: [
          'Parents and guardians: your name, email address, and booking details when you book a class or event.',
          "Children: first name and date of birth, provided by a parent or guardian at checkout. We use this only to manage the class register, group children appropriately by age, and acknowledge birthdays. Children's details are never published or shared publicly.",
          'Schools: contact name, email, phone number, and booking history for your school.',
          'Instructors: contact details, work areas, rates, and DBS certificates uploaded for safeguarding review.',
          'Payments: processed entirely by Stripe. We never see or store your card number — only the payment status and amount.',
        ],
      },
      {
        heading: 'How we use your data',
        paragraphs: [
          'To take and manage bookings, memberships, and event tickets (performing our contract with you).',
          'To send booking confirmations, receipts, event reminders, and service updates by email.',
          'To run our operations dashboard — scheduling, staffing, invoicing, and safeguarding checks (our legitimate interests).',
          'To meet legal and safeguarding obligations, including DBS verification for instructors working with children.',
        ],
      },
      {
        heading: 'Who processes your data',
        paragraphs: [
          'We use a small number of trusted processors: Stripe (payments), Supabase (secure database and sign-in), Resend (transactional email), and Render (website hosting). Each processes data only on our instructions and under their own security and data-protection terms. Some processors may handle data outside the UK; where they do, appropriate safeguards (such as standard contractual clauses) apply.',
        ],
      },
      {
        heading: 'How long we keep it',
        paragraphs: [
          "Booking and student records are kept while a membership is active and for up to 24 months afterwards, unless you ask us to delete them sooner. Financial records (invoices and payment references) are kept for up to 6 years to meet tax requirements. DBS certificates are kept only while an instructor works with us.",
        ],
      },
      {
        heading: 'Your rights',
        paragraphs: [
          'You can ask us at any time to: access the data we hold about you or your child, correct it, delete it, restrict how we use it, or receive a copy of it. Email us at ' + CONTACT_EMAIL + ' and we will respond within 30 days.',
          'If you are not satisfied with how we handle your data, you have the right to complain to the Information Commissioner\u2019s Office (ICO) at ico.org.uk.',
        ],
      },
      {
        heading: 'Cookies and storage',
        paragraphs: [
          'This site does not use advertising or tracking cookies. Your browser stores only what the site needs to function — your sign-in session and display preferences (for example, dismissed notifications) — via local storage.',
        ],
      },
    ],
  },
  terms: {
    title: 'Terms & Conditions',
    intro: 'These terms cover bookings, memberships, and event tickets purchased through King\'s Ark Dance Academy. By booking with us, you agree to them.',
    sections: [
      {
        heading: 'Classes and memberships',
        paragraphs: [
          'Monthly membership (£25/month) is a rolling subscription paid through Stripe. You can cancel at any time from your parent dashboard or the Stripe billing portal — cancellation stops future payments and your child\u2019s place remains active until the end of the paid period.',
          'A Day Pass (£10) covers one scheduled class date for the children named at checkout.',
          'Class places are confirmed only after payment completes. If a class is full or cancelled by us, we will offer an alternative date or a full refund.',
        ],
      },
      {
        heading: 'School workshops',
        paragraphs: [
          'Workshop enquiries made through the website are requests, not confirmed bookings. A booking is confirmed when we accept it in writing and issue an invoice.',
          'Invoices are payable within 14 days unless we agree otherwise in writing.',
          'If you need to cancel or move a confirmed workshop, contact us as early as possible; we will always try to accommodate a new date.',
        ],
      },
      {
        heading: 'Event tickets',
        paragraphs: [
          'Your confirmation email is your ticket. Ticket sales are processed by Stripe; ticket types and prices are shown before you pay.',
          'If an event is cancelled by us, tickets are refunded in full to the original payment method. For other refund requests, contact us at ' + CONTACT_EMAIL + ' and we will review them case by case.',
        ],
      },
      {
        heading: 'Safeguarding and conduct',
        paragraphs: [
          'All instructors working with children hold a DBS certificate reviewed by our team before they are assigned work.',
          'Dance is a physical activity. By booking, you confirm your child is fit to take part, and you accept that participation is at your own risk to the extent permitted by law. Nothing in these terms excludes liability for death or personal injury caused by our negligence.',
          'We may ask any participant whose behaviour is unsafe or disruptive to leave a session, without a refund.',
        ],
      },
      {
        heading: 'Photos and media',
        paragraphs: [
          'We sometimes photograph or film sessions for our website and social channels. We will always ask for consent first — verbally or in writing — and you can decline or withdraw consent at any time.',
        ],
      },
      {
        heading: 'General',
        paragraphs: [
          'We may update these terms from time to time; the version on this page applies to new bookings from the date shown below.',
          'These terms are governed by the laws of England and Wales, and the courts of England and Wales have exclusive jurisdiction.',
        ],
      },
    ],
  },
  accessibility: {
    title: 'Accessibility Statement',
    intro: 'We want everyone to be able to use this website and take part in our classes, regardless of ability or technology.',
    sections: [
      {
        heading: 'Our commitment',
        paragraphs: [
          'We aim for this website to meet WCAG 2.1 level AA. In practice that means readable text and contrast, keyboard-friendly navigation and forms, labelled controls for screen readers, and images with descriptive alternative text.',
        ],
      },
      {
        heading: 'Known limitations',
        paragraphs: [
          'Our testimonial videos do not yet have captions. If you need a transcript, email us and we will provide one.',
          'Some third-party content (such as the Stripe checkout pages) is governed by the accessibility of those providers.',
        ],
      },
      {
        heading: 'In the studio',
        paragraphs: [
          'Our classes are designed to be inclusive. If your child has additional needs, tell us when you book — we will adapt the session so they can take part fully and safely.',
        ],
      },
      {
        heading: 'Feedback',
        paragraphs: [
          'If anything on this site is hard to use, or you need information in a different format, contact us at ' + CONTACT_EMAIL + ' or +44 7535 897732. We take accessibility feedback seriously and will fix what we can.',
        ],
      },
    ],
  },
}

export function LegalPage({ page, onBack }) {
  const content = LEGAL_CONTENT[page] || LEGAL_CONTENT.privacy
  return (
    <div style={{ minHeight: '100vh', background: cream, fontFamily: sans, color: ink }}>
      <header style={{ background: emerald, color: ivory }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src="/images/logo.jpg" alt="King's Ark Dance Academy logo" style={{ width: 34, height: 34, borderRadius: 8, objectFit: 'cover' }} />
            <div>
              <div style={{ fontFamily: 'Fraunces, Georgia, serif', fontSize: 18, fontWeight: 700, lineHeight: 1.1 }}>King's Ark</div>
              <div style={{ fontSize: 11.5, color: '#d5a443', letterSpacing: '0.08em', textTransform: 'uppercase' }}>Dance Academy</div>
            </div>
          </div>
          <button type="button" onClick={onBack} style={{ background: 'transparent', border: '1px solid rgba(255,255,255,0.35)', color: ivory, borderRadius: 8, padding: '8px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>← Back to site</button>
        </div>
      </header>
      <main style={{ maxWidth: 820, margin: '0 auto', padding: '40px 20px 72px' }}>
        <div style={{ background: ivory, border: `1px solid ${rule}`, borderRadius: 14, padding: '36px 32px' }}>
          <h1 style={{ fontFamily: serif, fontSize: 34, fontWeight: 400, margin: '0 0 6px', color: emerald }}>{content.title}</h1>
          <p style={{ fontSize: 12, color: muted, margin: '0 0 18px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Last updated: {LAST_UPDATED}</p>
          <p style={{ fontSize: 15, lineHeight: 1.7, color: ink, margin: '0 0 24px' }}>{content.intro}</p>
          {content.sections.map((section) => (
            <section key={section.heading} style={{ borderTop: `1px solid ${rule}`, paddingTop: 18, marginBottom: 18 }}>
              <h2 style={{ fontFamily: serif, fontSize: 20, fontWeight: 400, margin: '0 0 8px', color: emerald }}>{section.heading}</h2>
              {section.paragraphs.map((paragraph, index) => (
                <p key={index} style={{ fontSize: 14, lineHeight: 1.7, color: ink, margin: '0 0 10px' }}>{paragraph}</p>
              ))}
            </section>
          ))}
          <p style={{ fontSize: 13, color: muted, margin: '24px 0 0' }}>
            Questions about this page? Email <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: emerald, fontWeight: 600 }}>{CONTACT_EMAIL}</a>.
          </p>
        </div>
        <p style={{ textAlign: 'center', fontSize: 12, color: muted, marginTop: 18 }}>
          <span style={{ color: gold }}>Faith · Culture · Movement</span> — King's Ark Dance Academy, Birmingham
        </p>
      </main>
    </div>
  )
}

export default LegalPage
