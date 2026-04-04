import { useState, useCallback, useEffect } from 'react';

const TOKEN_KEY   = 'tubeintel_oauth_token';
const EXPIRY_KEY  = 'tubeintel_oauth_expiry';
const PROFILE_KEY = 'tubeintel_oauth_profile';

const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
  'https://www.googleapis.com/auth/yt-analytics.readonly',
  'https://www.googleapis.com/auth/yt-analytics-monetary.readonly',
].join(' ');

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

  // Handle OAuth redirect (implicit flow: token in URL hash)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;
    const params = new URLSearchParams(hash.replace('#', '?'));
    const accessToken = params.get('access_token');
    const expiresIn   = parseInt(params.get('expires_in') || '3600');
    if (!accessToken) return;
    console.log('[TubeIntel OAuth] Token received successfully. Current origin:', window.location.origin);

    // Clean URL
    window.history.replaceState(null, '', window.location.pathname + window.location.search);

    const expiry = Date.now() + expiresIn * 1000;
    localStorage.setItem(TOKEN_KEY,  accessToken);
    localStorage.setItem(EXPIRY_KEY, String(expiry));
    setToken(accessToken);

    // Fetch profile info
    fetchProfile(accessToken).then(p => {
      if (p) {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
        setProfile(p);
      }
    });
  }, []);

  const connect = useCallback(() => {
    const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert('Google OAuth is not configured. Please add VITE_GOOGLE_CLIENT_ID to your .env file.\n\nSee the Setup Guide in the My Analytics section for instructions.');
      return;
    }
    const redirectUri = window.location.origin;
    console.log('[TubeIntel OAuth] redirect_uri being sent to Google:', redirectUri);
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id',     clientId);
    url.searchParams.set('redirect_uri',  redirectUri);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('scope',         SCOPES);
    url.searchParams.set('access_type',   'online');
    url.searchParams.set('prompt',        'select_account consent');
    console.log('[TubeIntel OAuth] Full auth URL:', url.toString());
    window.location.href = url.toString();
  }, []);

  const disconnect = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(EXPIRY_KEY);
    localStorage.removeItem(PROFILE_KEY);
    setToken(null);
    setProfile(null);
  }, []);

  const isConnected = !!token;

  return { token, profile, isConnected, connect, disconnect };
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
