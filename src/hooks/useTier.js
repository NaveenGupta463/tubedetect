import { useState, useCallback } from 'react';
import { TIER_LIMITS } from '../utils/tierConfig';
import * as storage from '../utils/storage';

const TIER_KEY   = 'yta_tier';
const CALLS_KEY  = 'yta_ai_calls';
const PERIOD_KEY = 'yta_ai_period';

export function useTier() {
  const [tier, setTierState] = useState(() => storage.get(TIER_KEY) || 'free');

  const setTier = useCallback((t) => {
    storage.set(TIER_KEY, t);
    setTierState(t);
  }, []);

  const getUsedCalls = useCallback(() => {
    const period = storage.get(PERIOD_KEY);
    const now = new Date().toISOString().slice(0, 7);
    if (period !== now) {
      storage.set(CALLS_KEY, '0');
      storage.set(PERIOD_KEY, now);
    }
    return parseInt(storage.get(CALLS_KEY) || '0');
  }, []);

  const canUseAI = useCallback(() => {
    const limit = TIER_LIMITS[tier]?.aiCalls ?? 0;
    if (limit === Infinity) return true;
    return getUsedCalls() < limit;
  }, [tier, getUsedCalls]);

  const consumeAICall = useCallback(() => {
    const used = getUsedCalls();
    storage.set(CALLS_KEY, String(used + 1));
  }, [getUsedCalls]);

  const remainingCalls = useCallback(() => {
    const limit = TIER_LIMITS[tier]?.aiCalls ?? 0;
    if (limit === Infinity) return 'Unlimited';
    return Math.max(0, limit - getUsedCalls());
  }, [tier, getUsedCalls]);

  return { tier, setTier, canUseAI, consumeAICall, remainingCalls };
}
