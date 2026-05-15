import { useState, useEffect } from 'react';

export function useCountUp(target, duration = 900, delay = 0) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    if (target === 0) return;
    let frame;
    const timeout = setTimeout(() => {
      let start = null;
      const step = (ts) => {
        if (!start) start = ts;
        const progress = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - progress, 3); // cubic ease-out
        setValue(Math.round(eased * target));
        if (progress < 1) frame = requestAnimationFrame(step);
        else setValue(target);
      };
      frame = requestAnimationFrame(step);
    }, delay);

    return () => { clearTimeout(timeout); cancelAnimationFrame(frame); };
  }, [target, duration, delay]);

  return value;
}
