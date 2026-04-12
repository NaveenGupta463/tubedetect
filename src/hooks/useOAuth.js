import { useState, useCallback, useEffect } from 'react';
import { loginWithGoogle, clearJWT } from '../api/auth';

const TOKEN_KEY    = 'tubeintel_oauth_token';
const EXPIRY_KEY   = 'tubeintel_oauth_expiry';
const PROFILE_KEY  = 'tubeintel_oauth_profile';
const VERIFIER_KEY = 'tubeintel_pkce_verifier';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

// ── PKCE helpers ──────────────────────────────────────────────────────────────
function generateVerifier() {
  const array = new Uint8Array(96);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateChallenge(verifier) {
  const encoded = new TextEncoder().encode(verifier);
  const digest  = await crypto.subtle.digest('SHA-256', encoded);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

export function useOAuth() {
  const [token,   setToken]   = useState(() => {
    try {
      const expiry = parseInt(localStorage.getItem(EXPIRY_KEY) || '0');
      if (Date.now() < expiry) return localStorage.getItem(TOKEN_KEY);
    } catch {}
    return null;
  });
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null'); } catch { return null; }
  });

  // ── Handle PKCE redirect: ?code=xxx ─────────────────────────────────────
  useEffect(() => {
    const params       = new URLSearchParams(window.location.search);
    const code         = params.get('code');
    const codeVerifier = sessionStorage.getItem(VERIFIER_KEY);

    if (!code || !codeVerifier) return;

    // Clean URL immediately so refresh doesn't re-trigger
    window.history.replaceState(null, '', window.location.pathname);
    sessionStorage.removeItem(VERIFIER_KEY);

    // Exchange code + verifier with backend → get access_token + JWT
    loginWithGoogle({ code, codeVerifier, redirectUri: window.location.origin })
      .then(({ accessToken, backendUser }) => {
        if (accessToken) {
          const expiry = Date.now() + 3600 * 1000; // 1 hour
          localStorage.setItem(TOKEN_KEY,  accessToken);
          localStorage.setItem(EXPIRY_KEY, String(expiry));
          setToken(accessToken);
        }
        if (backendUser) {
          localStorage.setItem('yta_tier', backendUser.tier);
        }
        if (accessToken) {
          fetchProfile(accessToken).then(p => {
            if (p) {
              localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
              setProfile(p);
            }
          });
        }
      })
      .catch(err => console.warn('[TubeIntel] PKCE exchange failed:', err.message));
  }, []);

  const connect = useCallback(async () => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert('Google OAuth is not configured. Please add VITE_GOOGLE_CLIENT_ID to your .env file.');
      return;
    }

    const verifier   = generateVerifier();
    const challenge  = await generateChallenge(verifier);
    const redirectUri = window.location.origin;

    // Store verifier in sessionStorage — survives the redirect, cleared after use
    sessionStorage.setItem(VERIFIER_KEY, verifier);

    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id',             clientId);
    url.searchParams.set('redirect_uri',          redirectUri);
    url.searchParams.set('response_type',         'code');
    url.searchParams.set('scope',                 SCOPES);
    url.searchParams.set('access_type',           'offline');
    url.searchParams.set('prompt',                'select_account consent');
    url.searchParams.set('code_challenge',        challenge);
    url.searchParams.set('code_challenge_method', 'S256');

    window.location.href = url.toString();
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(PROFILE_KEY);
    sessionStorage.removeItem(VERIFIER_KEY);
    clearJWT();
    setToken(null);
    setProfile(null);
  }, []);

  return { token, profile, isConnected: !!token, connect, disconnect };
}

async function fetchProfile(token) {
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&mine=true', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    const ch = data.items?.[0];
    if (!ch) return null;
    return {
      channelId:   ch.id,
      title:       ch.snippet?.title,
      thumbnail:   ch.snippet?.thumbnails?.default?.url,
      subscribers: ch.statistics?.subscriberCount,
      videoCount:  ch.statistics?.videoCount,
      viewCount:   ch.statistics?.viewCount,
    };
  } catch {
    return null;
  }
}
