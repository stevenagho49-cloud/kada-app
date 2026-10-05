export const PASSWORD_RESET_REDIRECT_URL = 'https://kingsarkdance.com/'

export function createTokenVerifier(auth) {
  const exchanges = new Map()
  return (tokenHash, type) => {
    const key = `${type}:${tokenHash}`
    if (!exchanges.has(key)) exchanges.set(key, auth.verifyOtp({ token_hash: tokenHash, type }))
    return exchanges.get(key)
  }
}

export function readAuthCallback(hash) {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  const type = params.get('type')
  return {
    tokenHash: params.get('token_hash'),
    type,
    isAuthLink: params.has('access_token') || params.has('token_hash') || params.has('error'),
    needsPasswordSetup: type === 'recovery' || type === 'invite',
    error: params.get('error_description') || params.get('error'),
  }
}
