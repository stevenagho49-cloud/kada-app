import React, { useEffect, useState } from 'react'
import { flyerPublicUrl, formatEventTimeRange } from './ops/EventsPage'
import { ClassDatePicker, DAY_NAMES, classEndedOnDate, nextClassDate, startOfToday } from './lib/classDates'

// Testimonial videos + posters live in Supabase Storage (public bucket) instead
// of the repo ,  keeps the git history and page payload small.
const SITE_MEDIA_URL = `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/site-media`
const videoAsset = (file) => `${SITE_MEDIA_URL}/videos/${file}`

export const HOME_SECTIONS = [
  { key: 'hero', label: 'Hero' },
  { key: 'stats', label: 'Stats strip' },
  { key: 'about', label: 'About' },
  { key: 'values', label: 'Values' },
  { key: 'workshops', label: 'School Workshops' },
  { key: 'classes', label: 'Saturday Classes' },
  { key: 'events', label: 'Events' },
  { key: 'team', label: 'Team' },
  { key: 'videos', label: 'Stories / Videos' },
  { key: 'sponsors', label: 'Sponsors' },
  { key: 'contact', label: 'Contact' },
]
export const DEFAULT_SECTION_ORDER = HOME_SECTIONS.map((section, index) => ({ sectionKey: section.key, label: section.label, visible: true, sortOrder: (index + 1) * 10 }))

/* Public contact form. Posts to /api/public/contact, which emails the admin
   inbox. Kept inside HomePage so it inherits the public site's fonts/colours. */
function ContactForm() {
  const [form, setForm] = useState({ name: '', email: '', topic: 'parent', message: '' })
  const [status, setStatus] = useState('idle') // idle | sending | sent | error
  const [errorText, setErrorText] = useState('')

  const set = (field) => (event) => setForm({ ...form, [field]: event.target.value })

  const submit = async (event) => {
    event.preventDefault()
    setStatus('sending')
    setErrorText('')
    try {
      const response = await fetch('/api/public/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Your message could not be sent.')
      setStatus('sent')
    } catch (error) {
      setErrorText(error.message)
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="contact-form contact-form-sent">
        <strong>Thank you, {form.name.split(' ')[0]}.</strong>
        <p>Your message is on its way. We usually reply within one working day.</p>
      </div>
    )
  }

  return (
    <form className="contact-form" onSubmit={submit}>
      <div className="contact-form-row">
        <input aria-label="Your name" placeholder="Your name" value={form.name} onChange={set('name')} required maxLength={120} />
        <input aria-label="Your email" type="email" placeholder="Your email" value={form.email} onChange={set('email')} required maxLength={200} />
      </div>
      <select aria-label="I am a" value={form.topic} onChange={set('topic')}>
        <option value="parent">I'm a parent</option>
        <option value="school">I'm contacting from a school</option>
        <option value="partnership">Partnership or media</option>
        <option value="other">Something else</option>
      </select>
      <textarea aria-label="Your message" placeholder="How can we help?" value={form.message} onChange={set('message')} required minLength={10} maxLength={3000} rows={4} />
      {status === 'error' && <p className="contact-form-error">{errorText}</p>}
      <button type="submit" className="btn btn-gold" disabled={status === 'sending'}>{status === 'sending' ? 'Sending…' : 'Send message'}</button>
    </form>
  )
}

export default function HomePage({ SectionError, siteEvents, siteContent = {}, sectionLayout, navigatePublicSection, openPublicForm, publicForm, setPublicForm, startClassCheckout, parentBooking, setParentBooking, checkoutBusy, classSessions = [], handleQuoteSubmit, schoolRequest, handleQuoteChange, quote, quotePrice, quoteStaff, valueItems, Modal }) {
  const selectedSession = classSessions.find((session) => session.name === parentBooking.className) || classSessions[0] || null

  // Homepage copy comes from the site_content table (editable in Ops). Every
  // value falls back to the original hardcoded text when a row is missing.
  const hero = siteContent.hero || {}
  const stats = siteContent.stats || {}
  const about = siteContent.about || {}
  const workshops = siteContent.workshops || {}
  const classes = siteContent.classes || {}
  const team = siteContent.team || {}
  const contact = siteContent.contact || {}
  const social = siteContent.social || {}
  const socialLinks = [
    { label: 'Instagram', url: social.instagram ?? 'https://www.instagram.com/kingsarkdance' },
    { label: 'TikTok', url: social.tiktok },
    { label: 'YouTube', url: social.youtube },
    { label: 'Facebook', url: social.facebook },
  ].filter((link) => link.url)
  const prices = siteContent.prices || {}
  const images = siteContent.images || {}
  const heroImg = images.hero || '/images/hero-workshop.jpeg'
  const heroFloatImg = images.heroFloat || '/images/nVgB0rjQ.jpeg'
  const aboutImg = images.about || '/images/about-kada.jpeg'
  const workshopsImg = images.workshopsBg || '/images/u.dance sunday warm up2.JPG'
  const classesImg = images.classesBg || '/images/u.dance saturday20.JPG'
  const membershipPounds = (prices.membershipPence ?? 2500) / 100
  const dayPassPounds = (prices.dayPassPence ?? 1000) / 100
  const teamMembers = Array.isArray(team.members) && team.members.length ? team.members : [
    { name: 'Steven', role: 'Founder & Lead Instructor', photo: '/images/team-steven.jpg' },
    { name: 'Temilade', role: 'Programme Coordinator', photo: '' },
    { name: 'Annedrea', role: 'School Partnerships', photo: '/images/team-annedrea.jpg' },
  ]

  // Pre-select the nearest upcoming real class date whenever the booking form
  // opens, the chosen class changes, or the schedule finishes loading.
  useEffect(() => {
    if (publicForm !== 'class' || !classSessions.length) return
    const session = classSessions.find((item) => item.name === parentBooking.className) || classSessions[0]
    const picked = parentBooking.classDate ? new Date(`${parentBooking.classDate}T00:00:00`) : null
    const dateValid = picked && !Number.isNaN(picked.getTime()) && picked >= startOfToday() && picked.getDay() === Number(session.day_of_week) && !classEndedOnDate(session, picked)
    if (session.name !== parentBooking.className || !dateValid) {
      setParentBooking({ ...parentBooking, className: session.name, classDate: nextClassDate(session) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicForm, parentBooking.className, classSessions])

  const renderSection = (sectionKey) => {
    switch (sectionKey) {
      case 'hero':
        return (
          <section className="hero" key="hero">
            <div className="wrap">
              <div className="hero-stamp" aria-label="Established Birmingham, King's Ark Dance Academy"><svg viewBox="0 0 104 104" aria-hidden="true"><defs><path id="hero-stamp-path" d="M 52,52 m -38,0 a 38,38 0 1,1 76,0 a 38,38 0 1,1 -76,0" /></defs><text><textPath href="#hero-stamp-path">EST. BIRMINGHAM · KING'S ARK DANCE ACADEMY · </textPath></text></svg></div>
              <div className="hero-grid hero-row">
              <div className="hero-copy">
                <div className="hero-eyebrow eyebrow">Faith · Culture · Movement</div>
                <h1 className="display reveal in">{hero.title || 'Inspiring, uplifting.'}<span className="line2">{hero.titleLine2 || 'Transforming lives.'}</span></h1>
                <p className="lede">{hero.lede || 'Faith inspired Gospel Afrobeats for the next generation, building confidence and character in children aged 5 to 16.'}</p>
                <div className="hero-ctas">
                  <a href="#classes" className="btn btn-gold" onClick={(event) => navigatePublicSection(event, '#classes')}>Our Classes</a>
                  <a href="#workshops" className="btn btn-outline">School Workshops</a>
                </div>
              </div>
              <div className="hero-visual-wrap"><div className="hero-visual reveal in" style={{ backgroundImage: `url('${heroImg}')` }}></div><div className="hero-float" aria-hidden="true" style={{ backgroundImage: `url('${heroFloatImg}')` }}></div></div>
              </div>
            </div>
          </section>
        )
      case 'stats':
        return (
          <section className="stats-strip" key="stats">
            <div className="wrap stats-grid">
              <div className="stat-inline"><div className="num display">{stats.childrenEmpowered || '1,000+'}</div><div className="label">Children<br />Empowered</div></div>
              <div className="stat-inline"><div className="num display">{stats.schoolsReached || '1,000+'}</div><div className="label">Schools<br />Reached</div></div>
              <div className="stat-inline"><div className="num display">{stats.yearsImpact || '10+'}</div><div className="label">Years of<br />Impact</div></div>
            </div>
          </section>
        )
      case 'about':
        return (
          <section className="about" id="about" key="about">
            <div className="wrap about-grid">
              <div className="about-img reveal" style={{ backgroundImage: `url('${aboutImg}')` }}></div>
              <div className="about-copy reveal reveal-delay-1">
                <div className="eyebrow wine">About KADA</div>
                <h2 className="display section-title">{about.title || 'More than dance.'} <em>{about.titleEmphasis || "It's a movement."}</em></h2>
                <p>{about.paragraph1 || "King's Ark Dance Academy, formerly Dance With Stago, is a faith inspired dance school rooted in Gospel Afrobeats. We work with children and young people aged 5 to 16, using dance to build confidence, teamwork, creativity and cultural awareness."}</p>
                <p>{about.paragraph2 || "We've delivered workshops in over a thousand UK schools, with moments alongside ITV, BBC and the Commonwealth Games. The heart of what we do happens in the room: a shy child finding their voice, a group of strangers becoming a team in under an hour."}</p>
                <a href="#contact" className="btn btn-dark-outline">{about.ctaLabel || 'Learn More About Us'}</a>
              </div>
            </div>
          </section>
        )
      case 'values':
        return (
          <section className="values" key="values">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">What We Stand On</span>
                <h2 className="display">Our <em>values.</em></h2>
              </div>

              <div className="value-list reveal">
                {valueItems.map((item) => (
                  <div className="value-line" key={item.roman}>
                    <span className="roman">{item.roman}</span>
                    <h3 className="display">{item.title}</h3>
                    <p>{item.text}</p>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )
      case 'workshops':
        return (
          <section className="service dark" id="workshops" key="workshops">
            <div className="service-bg" style={{ backgroundImage: `url('${workshopsImg}')` }}></div>
            <div className="wrap"><div className="service-card reveal">
              <span className="eyebrow">{workshops.eyebrow || 'For Schools'}</span>
              <h2 className="display">{workshops.title || 'Bring your school to life through Afrobeats.'}</h2>
              <p>{workshops.body || 'High energy, fully interactive workshops built for enrichment days, Culture Days and Black History Month. No dance experience needed, only enthusiasm.'}</p>
              <a href="#school-quote" className="btn btn-solid" onClick={(event) => openPublicForm(event, 'school')}>{workshops.ctaLabel || 'Get a Quote'}</a>
            </div></div>
          </section>
        )
      case 'classes':
        return (
          <React.Fragment key="classes">
            <section className="service light" id="classes">
              <div className="service-bg" style={{ backgroundImage: `url('${classesImg}')` }}></div>
              <div className="wrap"><div className="service-card reveal">
                <span className="eyebrow">{classes.eyebrow || 'For Families'}</span>
                <h2 className="display">{classes.title || 'Saturday classes, ages 5 to 15.'}</h2>
                <p>{classes.body || 'Confidence, creativity and skill, term by term, in a joyful and faith rooted environment.'}</p>
                <a href="#class-booking" className="btn btn-solid" onClick={(event) => openPublicForm(event, 'class')}>{classes.ctaLabel || 'Book a Saturday class'}</a>
              </div></div>
            </section>

            {publicForm === 'class' && <Modal title="Reserve a place" onClose={() => setPublicForm(null)} wide><section className="quote-section" id="class-booking">
              <div className="wrap quote-wrap">
                <div className="section-head left-align"><span className="eyebrow">Saturday Classes</span><h2 className="display">Reserve a place.</h2><p>Secure your child's place through secure checkout. The booking is confirmed after payment is completed.</p></div>
                <form className="quote-form" onSubmit={startClassCheckout}>
                  <label><span>Plan</span><select value={parentBooking.planType} onChange={(event) => setParentBooking({ ...parentBooking, planType: event.target.value })}><option value="monthly_membership">Monthly Membership (£{membershipPounds}/month)</option><option value="day_pass">Day Pass (£{dayPassPounds})</option></select></label>
                  {classSessions.length === 0 ? (
                    <p className="class-date-hint">Class times are being finalised. Please check back shortly.</p>
                  ) : (
                    <>
                      <label><span>Class</span><select value={parentBooking.className} onChange={(event) => setParentBooking({ ...parentBooking, className: event.target.value })}>{classSessions.map((session) => <option key={session.id} value={session.name}>{session.name} · {DAY_NAMES[Number(session.day_of_week)]}s {String(session.start_time).slice(0, 5)}</option>)}</select></label>
                      <div className="class-date-field"><span className="label">Class date</span><ClassDatePicker session={selectedSession} value={parentBooking.classDate} onChange={(date) => setParentBooking({ ...parentBooking, classDate: date })} /></div>
                    </>
                  )}
                  <label><span>Parent / guardian name</span><input value={parentBooking.parentName} onChange={(event) => setParentBooking({ ...parentBooking, parentName: event.target.value })} required /></label>
                  <label><span>Parent / guardian email</span><input type="email" value={parentBooking.parentEmail} onChange={(event) => setParentBooking({ ...parentBooking, parentEmail: event.target.value })} required /></label>
                  <div><span className="label">Children</span>{parentBooking.students.map((student, index) => <div key={index} className="student-row"><input aria-label={`Child ${index + 1} name`} placeholder="Child name" value={student.name} onChange={(event) => { const students = [...parentBooking.students]; students[index] = { ...student, name: event.target.value }; setParentBooking({ ...parentBooking, students }) }} required /><input aria-label={`Child ${index + 1} date of birth`} type="date" value={student.dateOfBirth} onChange={(event) => { const students = [...parentBooking.students]; students[index] = { ...student, dateOfBirth: event.target.value }; setParentBooking({ ...parentBooking, students }) }} required />{index > 0 && <button type="button" className="remove-child" onClick={() => setParentBooking({ ...parentBooking, students: parentBooking.students.filter((_, childIndex) => childIndex !== index) })}>Remove</button>}</div>)}<button type="button" className="add-child" onClick={() => setParentBooking({ ...parentBooking, students: [...parentBooking.students, { name: '', dateOfBirth: '' }] })}>+ Add another child</button></div>
                  <div className="quote-summary"><div><span className="label">Price</span><strong>{parentBooking.planType === 'monthly_membership' ? `£${membershipPounds} / month` : `£${dayPassPounds}`}</strong></div><div><span className="label">Payment</span><strong>{parentBooking.planType === 'monthly_membership' ? 'Recurring' : 'One-time'}</strong></div></div>
                  <button type="submit" className="btn btn-gold submit-btn" disabled={checkoutBusy || !parentBooking.classDate || !classSessions.length}>{checkoutBusy ? 'Opening checkout…' : 'Continue to payment'}</button>
                </form>
              </div>
            </section></Modal>}

            {publicForm === 'school' && <Modal title="Get a pricing estimate" onClose={() => setPublicForm(null)} wide><section className="quote-section" id="school-quote">
              <div className="wrap quote-wrap">
                <div className="section-head left-align">
                  <span className="eyebrow">School Enquiry</span>
                  <h2 className="display">Get a pricing estimate.</h2>
                </div>

                <form className="quote-form" onSubmit={handleQuoteSubmit}>
                  <div className="field-row">
                    <label>
                      <span>School name</span>
                      <input value={schoolRequest.schoolName} onChange={(event) => handleQuoteChange('schoolName', event.target.value)} placeholder="Your school" required />
                    </label>
                    <label>
                      <span>Contact name</span>
                      <input value={schoolRequest.contactName} onChange={(event) => handleQuoteChange('contactName', event.target.value)} placeholder="Name" required />
                    </label>
                  </div>

                  <div className="field-row">
                    <label>
                      <span>Email</span>
                      <input type="email" value={schoolRequest.email} onChange={(event) => handleQuoteChange('email', event.target.value)} placeholder="school@email.com" required />
                    </label>
                    <label>
                      <span>Student count</span>
                      <input type="number" min="1" value={schoolRequest.studentCount} onChange={(event) => handleQuoteChange('studentCount', Number(event.target.value))} required />
                    </label>
                  </div>

                  <div className="field-row">
                    <label>
                      <span>Session type</span>
                      <select value={schoolRequest.sessionType} onChange={(event) => handleQuoteChange('sessionType', event.target.value)}>
                        <option>Full day (£490)</option>
                        <option>Half day</option>
                        <option>Single workshop</option>
                        <option>Custom</option>
                      </select>
                    </label>
                    <label>
                      <span>Date</span>
                      <input type="date" value={schoolRequest.date} onChange={(event) => handleQuoteChange('date', event.target.value)} required />
                    </label>
                  </div>

                  <label>
                    <span>Notes</span>
                    <textarea value={schoolRequest.notes} onChange={(event) => handleQuoteChange('notes', event.target.value)} placeholder="Tell us about your event, age group or goals." />
                  </label>

                  {quote && (
                    <div className="quote-summary">
                      <div>
                        <span className="label">Estimated quote</span>
                        <strong>{quotePrice}</strong>
                      </div>
                      <div>
                        <span className="label">Instructor coverage</span>
                        <strong>{quoteStaff} staff</strong>
                      </div>
                    </div>
                  )}

                  <button type="submit" className="btn btn-gold submit-btn">Request booking</button>
                </form>
              </div>
            </section></Modal>}
          </React.Fragment>
        )
      case 'events':
        // No published, homepage-flagged events → hide the section completely
        // rather than showing an empty "Upcoming events" block.
        if (!siteEvents.length) return null
        return (
          <section className="events" id="events" key="events">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">What's On</span>
                <h2 className="display">Upcoming <em>events.</em></h2>
              </div>
              <div className="event-row reveal">
                {siteEvents.map((siteEvent) => (
                  <div className="event-card" key={siteEvent.id}>
                    {siteEvent.flyerPath && (
                      <img src={flyerPublicUrl(siteEvent.flyerPath)} alt={`${siteEvent.title} flyer`} style={{ width: '100%', height: 170, objectFit: 'cover', borderRadius: 10, marginBottom: 14, display: 'block' }} />
                    )}
                    <span className="event-date">
                      {siteEvent.eventDate ? new Date(`${siteEvent.eventDate}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Date to be announced'}
                      {formatEventTimeRange(siteEvent.eventTime, siteEvent.eventEndTime) ? ` · ${formatEventTimeRange(siteEvent.eventTime, siteEvent.eventEndTime)}` : ''}
                    </span>
                    <h3 className="display">{siteEvent.title}</h3>
                    {siteEvent.description && <p>{siteEvent.description}</p>}
                    {siteEvent.location && <div className="event-loc">📍 {siteEvent.location}</div>}
                    {siteEvent.ticketingEnabled && <a href={`#event/${siteEvent.id}`} className="btn btn-gold" style={{ display: 'inline-block', marginTop: 12 }}>Get tickets</a>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )
      case 'team':
        return (
          <section className="team" id="team" key="team">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">{team.eyebrow || 'The People Behind KADA'}</span>
                <h2 className="display">{team.title || 'Meet the team.'}</h2>
              </div>
              <div className="team-row reveal">
                {teamMembers.map((member) => (
                  <div className="team-card" key={member.name}>
                    {member.photo
                      ? <div className="photo" style={{ backgroundImage: `url('${member.photo}')` }}></div>
                      : <div className="photo placeholder-photo"><span>Photo coming soon</span></div>}
                    <div className="info"><div className="name display">{member.name}</div><div className="role">{member.role}</div></div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        )
      case 'videos':
        return (
          <section className="videos" id="videos" key="videos">
            <div className="wrap">
              <div className="section-head">
                <span className="eyebrow">In Their Own Words</span>
                <h2 className="display">Real stories, <em>real confidence.</em></h2>
              </div>

              <div className="video-row reveal">
                {[['A Parent’s Story', 'parent-review.mp4', 'parent-review-poster.jpg', 'landscape'], ['A Student’s Story', 'student-review.mp4', 'student-review-poster.jpg', 'portrait']].map(([label, file, poster, orientation]) => <div className="video-card" key={label}><div className={`video-frame video-frame-${orientation}`}><video controls preload="none" poster={videoAsset(poster)}><source src={videoAsset(file)} type="video/mp4" />Your browser cannot play this video.</video><span className="video-play" aria-hidden="true">▶</span></div><div className="video-caption"><div className="who display">{label}</div><div className="what">Watch the review</div></div></div>)}
              </div>
            </div>
          </section>
        )
      case 'sponsors':
        return (
          <section className="sponsors partners" key="sponsors">
            <div className="wrap">
              <span className="eyebrow">As seen on</span>
              <div className="partner-row reveal">
                {[
                  ['BBC', '/images/partners/bbc.png'],
                  ['ITV', '/images/partners/itv.jpeg'],
                  ['Commonwealth Games Birmingham 2022', '/images/partners/commonwealth-games-birmingham-2022.jpeg'],
                  ['NHS', '/images/partners/nhs.png'],
                  ["Britain's Got Talent", '/images/partners/britains-got-talent.jpeg'],
                ].map(([name, src]) => <img key={name} src={src} alt={name} title={name} loading="lazy" />)}
              </div>
            </div>
          </section>
        )
      case 'contact':
        return (
          <section className="contact" id="contact" key="contact">
            <div className="wrap">
              <div className="eyebrow">Get In Touch</div>
              <h2 className="display">{contact.heading || "Let's talk."}</h2>
              <p>{contact.intro || "Whether you're a parent, a school, or an organisation looking to partner with us, we'd love to hear from you."}</p>
              <ContactForm />
              <div className="contact-details">
                <div><span className="k">Email</span><a href={`mailto:${contact.email || 'bookings@kingsarkdance.com'}`} style={{ color: 'inherit' }}>{contact.email || 'bookings@kingsarkdance.com'}</a></div>
                <div><span className="k">Phone</span><a href={`tel:${(contact.phone || '+44 7535 897732').replace(/\s/g, '')}`} style={{ color: 'inherit' }}>{contact.phone || '+44 7535 897732'}</a></div>
                <div><span className="k">Address</span>{contact.address || '395 College Rd, Birmingham B44 0HF'}</div>
              </div>
            </div>
          </section>
        )
      default:
        return null
    }
  }

  const orderedVisibleSections = (sectionLayout && sectionLayout.length ? sectionLayout : DEFAULT_SECTION_ORDER)
    .filter((section) => section.visible)
    .sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="site-public">
      {orderedVisibleSections.map((section) => {
        const rendered = renderSection(section.sectionKey)
        if (!rendered) return null
        return SectionError ? <SectionError key={section.sectionKey}>{rendered}</SectionError> : rendered
      })}
      <footer>
        <div className="wrap footer-row">
          <div>
            <div className="f-brand">King's Ark Dance Academy</div>
            <div className="f-links">
              {socialLinks.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noreferrer">{link.label}</a>)}
            </div>
          </div>
          <div className="f-links">
            <a href="#terms">Terms &amp; Conditions</a>
            <a href="#privacy">Privacy Policy</a>
            <a href="#accessibility">Accessibility</a>
          </div>
        </div>

        <div className="bottom wrap">© 2026 King's Ark Dance Academy. All rights reserved.</div>
      </footer>
    </div>
  )
}
