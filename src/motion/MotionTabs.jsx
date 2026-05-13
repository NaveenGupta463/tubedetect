import { motion, AnimatePresence } from 'framer-motion';
import { spring, variants } from './spring';

export default function MotionTabs({ tabs, activeIndex, onChange, layoutId = 'tab-indicator', style = {}, tabStyle = {} }) {
  return (
    <div style={{ display: 'flex', position: 'relative', ...style }}>
      {tabs.map((tab, i) => {
        const isActive = i === activeIndex;
        const label = typeof tab === 'string' ? tab : tab.label;
        return (
          <motion.button
            key={label}
            onClick={() => onChange(i)}
            whileHover={{ color: '#8888ff' }}
            whileTap={variants.tap.nav}
            transition={spring.snappy}
            style={{
              position: 'relative',
              background: 'transparent',
              border: 'none',
              padding: '8px 14px',
              cursor: 'pointer',
              fontSize: '0.75rem',
              fontWeight: 600,
              fontFamily: 'monospace',
              color: isActive ? '#8888ff' : '#555',
              transition: 'color 0.15s ease',
              ...tabStyle,
            }}
          >
            {label}
            {isActive && (
              <motion.span
                layoutId={layoutId}
                style={{
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  right: 0,
                  height: 2,
                  background: '#8888ff',
                  borderRadius: '2px 2px 0 0',
                }}
                transition={spring.layout}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
