const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';
const JWT_KEY  = 'tubeintel_jwt';

export function getJWT()       { return localStorage.getItem(JWT_KEY); }
export function setJWT(token)  { localStorage.setItem(JWT_KEY, token); }
export function clearJWT()     { localStorage.removeItem(JWT_KEY); }

export function authHeaders() {
  const token = getJWT();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * Called after PKCE flow returns a code.
 * Sends { code, codeVerifier, redirectUri } to backend.
 * Backend exchanges with Google → gets access_token + refresh_token.
 * Returns { accessToken, backendUser }
 */
export async function loginWithGoogle({ code, codeVerifier, redirectUri }) {
  const res = await fetch(`${BACKEND}/api/auth/google`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ code, code_verifier: codeVerifier, redirect_uri: redirectUri }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Auth failed: ${res.status}`);
  }
  const { token, user, access_token } = await res.json();
  setJWT(token);
  return { accessToken: access_token, backendUser: user };
}

/**
 * Fetch fresh user data from the backend (tier, call counts, etc.)
 * Returns null if not logged in or token is invalid.
 */
export async function fetchUser() {
  const token = getJWT();
  if (!token) return null;
  const res = await fetch(`${BACKEND}/api/user/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { clearJWT(); return null; }
  if (!res.ok) return null;
  return res.json();
}

/**
 * Update tier via backend.
 */
export async function setUserTier(tier) {
  const res = await fetch(`${BACKEND}/api/user/tier`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body:    JSON.stringify({ tier }),
  });
  if (!res.ok) throw new Error('Failed to update tier');
  return res.json();
}
