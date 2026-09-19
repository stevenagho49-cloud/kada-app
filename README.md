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

## Checks

```bash
npm run lint
npm run build
```

## Resetting test data

Operations > Dashboard > "Review & reset test data" deletes all bookings, students, family accounts, and ticket orders after a typed confirmation. The endpoint only runs when `ALLOW_TEST_DATA_RESET=true` is set in the server environment — keep it set locally and unset (or set it temporarily) on production.
