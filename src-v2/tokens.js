export const T = {
  bg:          '#060608',
  surface:     '#1C1C1E',
  card:        '#141416',
  border:      'rgba(255,255,255,0.18)',
  borderHover: 'rgba(255,255,255,0.32)',
  text:        '#F0F0F0',
  muted:       '#888892',
  subtle:      '#4A4A52',
  accent:      '#9D6FFF',
  accentGlow:  'rgba(157,111,255,0.15)',
  accentBorder:'rgba(157,111,255,0.45)',
  success:     '#12D98A',
  successDim:  'rgba(18,217,138,0.15)',
  warning:     '#F9A825',
  warningDim:  'rgba(249,168,37,0.15)',
  danger:      '#F05252',
  dangerDim:   'rgba(240,82,82,0.15)',

  glassCard: {
    background:           'linear-gradient(160deg, rgba(255,255,255,0.06) 0%, transparent 50%), rgba(14,14,16,0.28)',
    backdropFilter:       'blur(0.5px) saturate(1.3)',
    WebkitBackdropFilter: 'blur(0.5px) saturate(1.3)',
    border:               '1px solid rgba(255,255,255,0.22)',
    boxShadow: [
      '0 0 30px rgba(255,255,255,0.10)',
      '0 0 80px rgba(255,255,255,0.05)',
      '0 24px 64px rgba(0,0,0,0.7)',
      'inset 0 1.5px 0 rgba(255,255,255,0.55)',
      'inset 0 -1px 0 rgba(255,255,255,0.06)',
      'inset 1px 0 0 rgba(255,255,255,0.14)',
      'inset -1px 0 0 rgba(255,255,255,0.06)',
    ].join(', '),
  },

  glassSurface: {
    background:           'linear-gradient(160deg, rgba(255,255,255,0.04) 0%, transparent 50%), rgba(18,18,20,0.22)',
    backdropFilter:       'blur(0.5px) saturate(1.3)',
    WebkitBackdropFilter: 'blur(0.5px) saturate(1.3)',
    border:               '1px solid rgba(255,255,255,0.14)',
    boxShadow: [
      '0 0 20px rgba(255,255,255,0.06)',
      'inset 0 1px 0 rgba(255,255,255,0.30)',
      'inset 0 -1px 0 rgba(255,255,255,0.04)',
    ].join(', '),
  },
};

export const spring = {
  snappy:  { type: 'spring', stiffness: 500, damping: 35 },
  smooth:  { type: 'spring', stiffness: 300, damping: 28 },
  slow:    { type: 'spring', stiffness: 180, damping: 24 },
};

export const ease = [0.16, 1, 0.3, 1]; // expo out — feels instant then settles
