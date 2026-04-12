import { useState, useRef } from 'react';

export default function Tooltip({ children, title, desc, placement = 'right' }) {
  const [pos, setPos]         = useState(null);
  const tooltipRef            = useRef(null);
  const triggerRef            = useRef(null);

  const show = () => {
    if (!triggerRef.current) return;
    const r   = triggerRef.current.getBoundingClientRect();
    const gap = 10;
    // We don't know tooltip size yet so use estimates, then clamp after render
    let top, left;
    if (placement === 'right') {
      top  = r.top + r.height / 2;   // will be offset by -50% via transform
      left = r.right + gap;
    } else if (placement === 'top') {
      top  = r.top - gap;             // will be offset by -100% via transform
      left = r.left + r.width / 2;   // will be offset by -50% via transform
    } else if (placement === 'bottom') {
      top  = r.bottom + gap;
      left = r.left + r.width / 2;
    } else { // left
      top  = r.top + r.height / 2;
      left = r.left - gap;
    }
    setPos({ top, left, placement, rect: r });
  };

  const hide = () => setPos(null);

  // transform per placement so tooltip sits correctly relative to anchor
  const getTransform = () => {
    switch (placement) {
      case 'right':  return 'translateY(-50%)';
      case 'left':   return 'translate(-100%, -50%)';
      case 'top':    return 'translate(-50%, -100%)';
      case 'bottom': return 'translateX(-50%)';
      default:       return '';
    }
  };

  return (
    <>
      <span
        ref={triggerRef}
        onMouseEnter={show}
        onMouseLeave={hide}
        style={{ display: 'block' }}
      >
        {children}
      </span>

      {pos && (
        <div
          ref={tooltipRef}
          style={{
            position:      'fixed',
            top:           pos.top,
            left:          pos.left,
            transform:     getTransform(),
            zIndex:        99999,
            background:    '#161616',
            border:        '1px solid #2e2e2e',
            borderRadius:  10,
            padding:       '10px 13px',
            maxWidth:      220,
            boxShadow:     '0 8px 32px rgba(0,0,0,0.8)',
            pointerEvents: 'none',
            animation:     'ti-tooltip-in 0.12s ease',
          }}
        >
          {title && (
            <div style={{ fontSize: 12, fontWeight: 800, color: '#fff', marginBottom: desc ? 5 : 0, lineHeight: 1.3 }}>
              {title}
            </div>
          )}
          {desc && (
            <div style={{ fontSize: 11, color: '#888', lineHeight: 1.6 }}>
              {desc}
            </div>
          )}
        </div>
      )}
    </>
  );
}
