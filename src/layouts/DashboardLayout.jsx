import { motion, AnimatePresence } from 'framer-motion';
import AnalyzeInput from '../screens/AnalyzeInput';
import WhatToPost   from '../screens/WhatToPost';
import Validator    from '../screens/Validator';
import { spring, variants } from '../motion/spring';

const TABS = [
  { id: 'analyze',    label: 'Analyze',               navId: 'dashboard'   },
  { id: 'whatToPost', label: 'What to Post',           navId: 'whatToPost'  },
  { id: 'validator',  label: 'Pre-Publish Validator',  navId: 'validator'   },
];

export default function DashboardLayout({ aiProps, channel, videos, activeTab = 'analyze', onTabChange }) {
  return (
    <div>
      {/* Tab strip — negative margin breaks out of main-scroll's side padding */}
      <div style={{
        display: 'flex',
        borderBottom: '1px solid rgba(255,255,255,0.055)',
        margin: '0 -24px',
        padding: '0 24px',
        background: 'rgba(8,8,8,0.98)',
        position: 'sticky',
        top: 0,
        zIndex: 50,
        backdropFilter: 'blur(12px)',
        gap: 2,
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.navId)}
              whileHover={{ color: active ? '#f2f2f2' : '#a8a8a8' }}
              whileTap={{ scale: 0.98 }}
              transition={spring.snappy}
              style={{
                position:     'relative',
                background:   'none',
                border:       'none',
                borderBottom: active ? '2px solid #e53e3e' : '2px solid transparent',
                color:        active ? '#f2f2f2' : '#585858',
                padding:      '11px 18px 13px',
                fontSize:     13,
                fontWeight:   active ? 600 : 400,
                cursor:       'pointer',
                marginBottom: -1,
                letterSpacing: active ? '-0.2px' : 0,
                whiteSpace:   'nowrap',
                transition:   'color 0.16s, border-color 0.16s',
              }}
            >
              {tab.label}
            </motion.button>
          );
        })}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          variants={variants.slideUp}
          initial="hidden"
          animate="visible"
          exit="exit"
          style={{ paddingTop: 28 }}
        >
          {activeTab === 'analyze'    && <AnalyzeInput onNavigate={onTabChange} />}
          {activeTab === 'whatToPost' && <WhatToPost channel={channel} />}
          {activeTab === 'validator'  && <Validator  {...aiProps} channel={channel} videos={videos} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
