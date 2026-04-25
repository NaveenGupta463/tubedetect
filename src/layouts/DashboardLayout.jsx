import AnalyzeInput from '../screens/AnalyzeInput';
import WhatToPost   from '../screens/WhatToPost';
import Validator    from '../screens/Validator';

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
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.navId)}
              style={{
                background:    active ? 'rgba(255,0,0,0.07)' : 'none',
                border:        'none',
                borderBottom:  active ? '3px solid #ff0000' : '3px solid transparent',
                color:         active ? '#ffffff' : '#555',
                padding:       '13px 20px',
                fontSize:      13,
                fontWeight:    active ? 600 : 400,
                cursor:        'pointer',
                transition:    'color 0.16s ease, border-color 0.16s ease, background 0.16s ease',
                marginBottom:  -1,
                letterSpacing: active ? '-0.2px' : 0,
                whiteSpace:    'nowrap',
                borderRadius:  active ? '6px 6px 0 0' : 0,
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div style={{ paddingTop: 28 }}>
        {activeTab === 'analyze'    && <AnalyzeInput onNavigate={onTabChange} />}
        {activeTab === 'whatToPost' && <WhatToPost />}
        {activeTab === 'validator'  && <Validator  {...aiProps} channel={channel} videos={videos} />}
      </div>
    </div>
  );
}
