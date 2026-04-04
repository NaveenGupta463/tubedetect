import { useState, useCallback } from 'react';
import { TIER_LIMITS } from '../utils/tierConfig';

const TIER_KEY   = 'yta_tier';
const CALLS_KEY  = 'yta_ai_calls';
const PERIOD_KEY = 'yta_ai_period';

export function useTier() {
  const [tier, setTierState] = useState(() => localStorage.getItem(TIER_KEY) || 'free');

  const setTier = useCallback((t) => {
    localStorage.setItem(TIER_KEY, t);
    setTierState(t);
  }, []);

  const getUsedCalls = useCallback(() => {
    const period = localStorage.getItem(PERIOD_KEY);
    const now = new Date().toISOString().slice(0, 7);
    if (period !== now) {
      localStorage.setItem(CALLS_KEY, '0');
      localStorage.setItem(PERIOD_KEY, now);
    }
    return parseInt(localStorage.getItem(CALLS_KEY) || '0');
  }, []);

  const canUseAI = useCallback(() => {
    const limit = TIER_LIMITS[tier]?.aiCalls ?? 0;
    if (limit === Infinity) return true;
    return getUsedCalls() < limit;
  }, [tier, getUsedCalls]);

  const consumeAICall = useCallback(() => {
    const used = getUsedCalls();
    localStorage.setItem(CALLS_KEY, String(used + 1));
  }, [getUsedCalls]);

  const remainingCalls = useCallback(() => {
    const limit = TIER_LIMITS[tier]?.aiCalls ?? 0;
    if (limit === Infinity) return 'Unlimited';
    return Math.max(0, limit - getUsedCalls());
  }, [tier, getUsedCalls]);

  return { tier, setTier, canUseAI, consumeAICall, remainingCalls };
}
