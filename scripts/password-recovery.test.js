import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTokenVerifier, PASSWORD_RESET_REDIRECT_URL, readAuthCallback } from '../src/lib/authRecovery.js'
import { PASSWORD_RESET_MESSAGE, passwordResetEmail, sendPasswordRecovery } from '../server/passwordRecovery.js'

test('reset email is branded and all links use the canonical HTTPS domain', () => {
  const email = passwordResetEmail('test-token&unsafe')
  assert.match(email.subject, /King's Ark Dance Academy/)
  assert.match(email.html, /Reset my password/)
  assert.doesNotMatch(email.html, /localhost|supabase\.co|onboarding@resend/)
  const links = [...email.html.matchAll(/href="([^"]+)"/g)].map((match) => new URL(match[1]))
  assert.equal(links.length, 3)
  assert.ok(links.every((url) => url.origin === 'https://kingsarkdance.com'))
  assert.equal(new URLSearchParams(links[0].hash.slice(1)).get('token_hash'), 'test-token&unsafe')
  assert.equal(new URLSearchParams(links[0].hash.slice(1)).get('type'), 'recovery')
})

test('recovery/invitation callbacks require setup, ordinary sign-in does not', () => {
  for (const hash of ['#token_hash=abc&type=recovery', '#access_token=abc&type=recovery', '#access_token=abc&type=invite']) {
    const callback = readAuthCallback(hash)
    assert.equal(callback.isAuthLink, true)
    assert.equal(callback.needsPasswordSetup, true)
  }
  assert.equal(readAuthCallback('#access_token=abc&type=signup').needsPasswordSetup, false)
  assert.equal(readAuthCallback('#ops/bookings').isAuthLink, false)
  assert.equal(readAuthCallback('#error=access_denied&error_description=Link+expired').error, 'Link expired')
})

test('single-use tokens are exchanged once even if effects remount', async () => {
  let calls = 0
  const verify = createTokenVerifier({ verifyOtp: async () => { calls += 1; return { error: null } } })
  await Promise.all([verify('abc', 'recovery'), verify('abc', 'recovery')])
  assert.equal(calls, 1)
})

function service(result, capture = () => {}) {
  return { auth: { admin: { generateLink: async (options) => { capture(options); return result } } } }
}

test('built-in Supabase recovery token is sent through the branded sender', async () => {
  let sent
  await sendPasswordRecovery({
    supabase: service({ data: { properties: { hashed_token: 'supabase-token' } }, error: null }, (options) => {
      assert.deepEqual(options, { type: 'recovery', email: 'test@example.com', options: { redirectTo: PASSWORD_RESET_REDIRECT_URL } })
    }),
    email: 'test@example.com',
    sendEmail: async (email) => { sent = email; return { sent: true } },
  })
  assert.equal(sent.to, 'test@example.com')
  assert.match(sent.html, /#token_hash=supabase-token&type=recovery/)
})

test('unknown addresses do not reveal account existence or send email', async () => {
  await sendPasswordRecovery({
    supabase: service({ error: { code: 'user_not_found' } }),
    email: 'missing@example.com',
    sendEmail: () => assert.fail('Must not send'),
  })
  assert.match(PASSWORD_RESET_MESSAGE, /^If an account exists/)
})

test('token generation and delivery failures are not reported as success', async () => {
  for (const result of [{ error: { code: 'unexpected', message: 'Unavailable' } }, { data: {} }]) {
    await assert.rejects(sendPasswordRecovery({ supabase: service(result), email: 'test@example.com', sendEmail: () => assert.fail('Must not send') }), /Recovery token generation/)
  }
  await assert.rejects(sendPasswordRecovery({
    supabase: service({ data: { properties: { hashed_token: 'abc' } } }),
    email: 'test@example.com',
    sendEmail: async () => ({ sent: false, reason: 'Provider unavailable' }),
  }), /Recovery email delivery failed/)
})
