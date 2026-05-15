export const T = {
  bg:          '#111114',
  surface:     '#18181B',
  card:        '#1C1C20',
  border:      'rgba(255,255,255,0.06)',
  borderHover: 'rgba(255,255,255,0.14)',
  text:        '#FAFAFA',
  muted:       '#71717A',
  subtle:      '#3F3F46',
  accent:      '#8B5CF6',
  accentGlow:  'rgba(139,92,246,0.12)',
  accentBorder:'rgba(139,92,246,0.3)',
  success:     '#10B981',
  successDim:  'rgba(16,185,129,0.12)',
  warning:     '#F59E0B',
  warningDim:  'rgba(245,158,11,0.12)',
  danger:      '#EF4444',
  dangerDim:   'rgba(239,68,68,0.12)',
};

export const spring = {
  snappy:  { type: 'spring', stiffness: 500, damping: 35 },
  smooth:  { type: 'spring', stiffness: 300, damping: 28 },
  slow:    { type: 'spring', stiffness: 180, damping: 24 },
};

export const ease = [0.16, 1, 0.3, 1]; // expo out — feels instant then settles
