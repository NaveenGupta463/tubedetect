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
        borderBottom: '1px solid #202020',
        margin: '0 -24px',
        padding: '0 24px',
        background: '#0d0d0d',
        position: 'sticky',
        top: 0,
        zIndex: 50,
      }}>
        {TABS.map(tab => {
          const active = activeTab === tab.id;
          return (
            <motion.button
              key={tab.id}
              onClick={() => onTabChange(tab.navId)}
              whileHover={{ color: active ? '#ffffff' : '#aaa' }}
              whileTap={{ scale: 0.98 }}
              transition={spring.snappy}
              style={{
                position:     'relative',
                background:   active ? 'rgba(255,0,0,0.07)' : 'none',
                border:       'none',
                color:        active ? '#ffffff' : '#555',
                padding:      '13px 20px',
                fontSize:     13,
                fontWeight:   active ? 600 : 400,
                cursor:       'pointer',
                marginBottom: -1,
                letterSpacing: active ? '-0.2px' : 0,
                whiteSpace:   'nowrap',
                borderRadius: active ? '6px 6px 0 0' : 0,
              }}
            >
              {tab.label}
              {active && (
                <motion.span
                  layoutId="dashboard-tab-indicator"
                  style={{
                    position: 'absolute',
                    bottom: -1, left: 0, right: 0,
                    height: 3,
                    background: '#ff0000',
                    borderRadius: '2px 2px 0 0',
                  }}
                  transition={spring.layout}
                />
              )}
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
          {activeTab === 'whatToPost' && <WhatToPost />}
          {activeTab === 'validator'  && <Validator  {...aiProps} channel={channel} videos={videos} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
