import { PASSWORD_RESET_REDIRECT_URL } from '../src/lib/authRecovery.js'

export const PASSWORD_RESET_MESSAGE = 'If an account exists for this email, you will receive a password reset link. Check your inbox and spam folder.'

export function passwordResetEmail(tokenHash) {
  const resetUrl = `${PASSWORD_RESET_REDIRECT_URL}#token_hash=${encodeURIComponent(tokenHash)}&type=recovery`
  return {
    subject: "Reset your password - King's Ark Dance Academy",
    html: `<div style="font-family:Arial,sans-serif;line-height:1.6;max-width:560px;background:#f6f3ea;padding:24px 16px;color:#232323"><div style="background:#fffdf8;border:1px solid #e4ddc9;border-radius:14px;overflow:hidden"><div style="height:6px;background:#0b3d2e"></div><div style="padding:26px"><p style="color:#0b3d2e;font-weight:bold">King's Ark Dance Academy</p><h1 style="color:#0b3d2e;font-family:Georgia,serif;font-weight:500">Reset your password</h1><p>We received a request to reset the password for your KADA account.</p><p>Choose a new password using the secure button below.</p><p style="margin:24px 0"><a href="${resetUrl}" style="background:#0b3d2e;color:#fffdf8;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">Reset my password</a></p><p>This link is single-use and expires shortly. If it expires, request a new link from the sign-in page.</p><p>If you did not request this, you can ignore this email. Your password will not change until you choose a new one.</p><p style="color:#767066;font-size:12px">If the button does not work, copy this link into your browser:<br><a href="${resetUrl}" style="color:#0b3d2e;word-break:break-all">${resetUrl}</a></p><p style="border-top:1px solid #e4ddc9;padding-top:16px;color:#767066;font-size:12px">King's Ark Dance Academy · <a href="${PASSWORD_RESET_REDIRECT_URL}" style="color:#0b3d2e">kingsarkdance.com</a></p></div></div></div>`,
  }
}

export async function sendPasswordRecovery({ supabase, sendEmail, email }) {
  const { data, error } = await supabase.auth.admin.generateLink({
    type: 'recovery',
    email,
    options: { redirectTo: PASSWORD_RESET_REDIRECT_URL },
  })
  // Match Supabase's recovery behaviour without disclosing registered addresses.
  if (error?.code === 'user_not_found') return
  if (error) throw new Error(`Recovery token generation failed: ${error.message}`)
  const tokenHash = data?.properties?.hashed_token
  if (!tokenHash) throw new Error('Recovery token generation returned no token.')
  const result = await sendEmail({ to: email, ...passwordResetEmail(tokenHash) })
  if (!result.sent) throw new Error(`Recovery email delivery failed: ${result.reason || 'unknown error'}`)
}
