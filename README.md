# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

# King's Ark Dance Academy

Vite + React operations app and public website backed by Supabase.

## Local development

```bash
npm install
npm run dev
```

The local Supabase URL and anon key belong in `.env`. Keep `.env` private; `.env.example` is the shareable template.

## Supabase accounts

Run `supabase-schema.sql` in the Supabase SQL Editor. The script adds Auth profiles, the signup trigger, and role-based RLS policies.

School and instructor users can create accounts from the Operations sign-in screen. A school signup creates a private school record automatically. Instructor signups create a profile that an admin must link to an instructor record.

Create the admin user in Supabase Dashboard > Authentication > Users, then run this with that user's Auth UUID:

```sql
update public.profiles set role = 'admin' where id = 'AUTH_USER_UUID';
```

Link an instructor account to an instructor record with:

```sql
update public.profiles set instructor_id = 'INSTRUCTOR_RECORD_ID' where id = 'AUTH_USER_UUID';
```

The database policies enforce the visibility rules: admins manage everything, schools read and request bookings for their own school, and instructors read only assigned bookings plus the workshop template.

## Students and birthdays

Run the latest `supabase-schema.sql` to create the `students` table. Parent class checkout collects the student's name and date of birth; the Stripe webhook creates the active roster record after payment. Operations calculates age from the date of birth and flags active students whose birthday is today or within seven days.

## Stripe test checkout

Parent class payments use the server in `server/index.js`. Put the rotated Stripe test secret, webhook secret, Supabase service-role key, and other server values in `.env`; only the publishable key may use a `VITE_` prefix. Start both services with `npm run dev`.

For local webhook delivery, run `stripe listen --forward-to localhost:4242/api/stripe/webhook` and copy the returned `whsec_...` value into `STRIPE_WEBHOOK_SECRET`. The webhook creates a confirmed, paid booking after `checkout.session.completed`.

The Stripe secret supplied in chat should be revoked and replaced before testing.

## Automatic invoice emails

Confirmed school bookings are sent through Resend by `server/index.js`. Add `RESEND_API_KEY`, `INVOICE_FROM_EMAIL` (a verified Resend sender), and `ADMIN_NOTIFICATION_EMAIL` to `.env`. The admin address is BCC'd on every invoice. Resend's default `onboarding@resend.dev` sender is suitable only for limited testing and generally requires the recipient to be the Resend account owner; verify a domain for real school recipients.

## Contacts CRM, team access & settings

Three migrations add the CRM, staff accounts and settings (apply each in Supabase Dashboard > SQL Editor — all idempotent):

- `supabase/migrations/20260921_staff_permissions.sql` — `staff` role + per-area `permissions` on profiles, the `current_user_has_permission()` RLS helper, and staff policies for bookings, students, events, site, sales and messages.
- `supabase/migrations/20260921_crm_contacts.sql` — the `contacts` table (schools/parents/clients/partners), deduped by email.
- `supabase/migrations/20260921_settings_and_user_prefs.sql` — admin-only `app_settings`, public `site_content` seeds for social links/branding, and parent-editable family/student welfare columns.

**Contacts (Operations > Contacts).** Add contacts manually, import old spreadsheets (`.xlsx`, `.csv`, or paste cells copied from Excel — columns are auto-mapped and existing contacts matched by email, never duplicated), file a pasted email with "Add from email", or export everything to CSV. Website contact-form enquiries are filed automatically by the server.

**Email → database.** `POST /api/inbound-email?token=…` files the sender into Contacts. Set `INBOUND_EMAIL_SECRET` (any long random string) in the server environment, then create an automation that POSTs `{ "from": "Name <a@b.com>", "subject": "…", "text": "…" }` whenever mail arrives at your bookings inbox — Power Automate ("When a new email arrives" → HTTP) for Microsoft 365, or a Zapier/Make webhook step for Gmail/Google Workspace. Mailgun Routes can also POST form data directly to the same URL.

**Team & access (Operations > Administration > Team & access, admins only).** Invite staff by email — the invite link lets them set their password. Each staff member gets a job title and a tick-box list of areas (Bookings & calendar, Contacts, Students & class schedule, Events & ticketing, Messages, Site, Sales). Access is enforced in the database by RLS, not just hidden in the UI. Removing access deletes their sign-in.

**Settings (Operations > Administration > Settings).** Edit the business address/phone/email (used on the public site and invoices), swap the header logo by URL, manage footer social links, and choose where admin alert emails go (overrides `ADMIN_NOTIFICATION_EMAIL`) with per-type on/off switches — all live immediately, no redeploy.

**Parent portal > Settings.** Parents edit their own contact details, emergency contact, communication preferences, and each child's dietary requirements, allergies/medical notes and photo consent. Saved via `POST /api/parent/settings`, which verifies family ownership server-side.

## Checks

```bash
npm run lint
npm run build
```

## Resetting test data

Operations > Dashboard > "Review & reset test data" deletes all bookings, students, family accounts, and ticket orders after a typed confirmation. The endpoint only runs when `ALLOW_TEST_DATA_RESET=true` is set in the server environment — keep it set locally and unset (or set it temporarily) on production.
