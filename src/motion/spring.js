import { cubicBezier } from 'framer-motion';

export const spring = {
  snappy:  { type: 'spring', stiffness: 400, damping: 30 },
  smooth:  { type: 'spring', stiffness: 260, damping: 28 },
  gentle:  { type: 'spring', stiffness: 180, damping: 24 },
  bouncy:  { type: 'spring', stiffness: 320, damping: 20 },
  stiff:   { type: 'spring', stiffness: 500, damping: 35 },
  layout:  { type: 'spring', stiffness: 300, damping: 30 },
};

export const duration = {
  instant: 0.08,
  fast:    0.15,
  base:    0.22,
  slow:    0.35,
  xslow:   0.5,
};

export const ease = {
  out:      [0.0, 0.0, 0.2, 1.0],
  in:       [0.4, 0.0, 1.0, 1.0],
  inOut:    [0.4, 0.0, 0.2, 1.0],
  expo:     [0.16, 1, 0.3, 1],
  back:     [0.34, 1.56, 0.64, 1],
};

export const stagger = {
  fast:   { staggerChildren: 0.04, delayChildren: 0.0 },
  base:   { staggerChildren: 0.06, delayChildren: 0.05 },
  slow:   { staggerChildren: 0.1,  delayChildren: 0.1  },
  list:   { staggerChildren: 0.05, delayChildren: 0.02 },
};

export const variants = {
  hover: {
    card:   { y: -2, boxShadow: '0 8px 32px rgba(0,0,0,0.45)', transition: spring.snappy },
    button: { scale: 1.02, transition: spring.snappy },
    nav:    { x: 2,  transition: spring.snappy },
  },
  tap: {
    button: { scale: 0.97, transition: spring.stiff },
    nav:    { scale: 0.98, transition: spring.stiff },
  },

  fade: {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { duration: duration.base, ease: ease.out } },
    exit:    { opacity: 0, transition: { duration: duration.fast, ease: ease.in  } },
  },

  slideUp: {
    hidden:  { opacity: 0, y: 12 },
    visible: { opacity: 1, y: 0,  transition: { duration: duration.base, ease: ease.expo } },
    exit:    { opacity: 0, y: -8, transition: { duration: duration.fast, ease: ease.in  } },
  },

  slideRight: {
    hidden:  { opacity: 0, x: -16 },
    visible: { opacity: 1, x: 0,   transition: spring.smooth },
    exit:    { opacity: 0, x: 16,  transition: { duration: duration.fast } },
  },

  scale: {
    hidden:  { opacity: 0, scale: 0.95 },
    visible: { opacity: 1, scale: 1,    transition: spring.smooth },
    exit:    { opacity: 0, scale: 0.97, transition: { duration: duration.fast } },
  },

  modal: {
    hidden:  { opacity: 0, scale: 0.92, y: 20 },
    visible: { opacity: 1, scale: 1,    y: 0,  transition: spring.bouncy },
    exit:    { opacity: 0, scale: 0.96, y: 12, transition: { duration: duration.base, ease: ease.in } },
  },

  overlay: {
    hidden:  { opacity: 0 },
    visible: { opacity: 1, transition: { duration: duration.base } },
    exit:    { opacity: 0, transition: { duration: duration.base } },
  },

  page: {
    hidden:  { opacity: 0, y: 8 },
    visible: { opacity: 1, y: 0,  transition: { duration: duration.base, ease: ease.expo, staggerChildren: 0.06 } },
    exit:    { opacity: 0, y: -4, transition: { duration: duration.fast, ease: ease.in } },
  },

  listItem: {
    hidden:  { opacity: 0, y: 8  },
    visible: { opacity: 1, y: 0, transition: { duration: duration.base, ease: ease.expo } },
  },

  container: {
    hidden:  {},
    visible: { transition: stagger.base },
  },
};
