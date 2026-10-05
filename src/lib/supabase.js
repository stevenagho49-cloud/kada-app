import { createClient } from '@supabase/supabase-js'
import { createTokenVerifier, readAuthCallback } from './authRecovery'

// The SDK can consume/clear an access-token hash before React's effects run.
export const initialAuthCallback = readAuthCallback(window.location.hash)

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null

// React StrictMode remounts effects; a single-use token must only be exchanged once.
export const verifyAuthToken = supabase ? createTokenVerifier(supabase.auth) : null

export default supabase
