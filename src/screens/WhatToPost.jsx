import { useState } from 'react';

// ── Mock data ────────────────────────────────────────────────────────────────

const MOCK = {
  trending: [
    {
      id: 1,
      title: 'I Tested Every Productivity System for 90 Days — Here\'s the Only One That Worked',
      hook: 'By day 30 I had abandoned four different systems. But then I stumbled on something nobody talks about.',
      potential: 87,
      angle: 'curiosity',
      whyItWorks: [
        'Number-based experiment framing drives high CTR',
        'Contrarian angle (rejection of popular systems) creates tension',
        'Personal experience lens builds trust and relatability',
      ],
      tags: ['productivity', 'systems', 'experiment'],
    },
    {
      id: 2,
      title: 'The Morning Routine Nobody Tells You About (From Someone Who Hates Mornings)',
      hook: 'I\'ve tried every 5am routine on YouTube. They all failed. Here\'s why — and what I do instead.',
      potential: 82,
      angle: 'emotion',
      whyItWorks: [
        'Relatable anti-hero positioning appeals to non-morning people',
        'Contrarian take on oversaturated topic stands out in feed',
        'Implicit promise of a shortcut drives click-through',
      ],
      tags: ['morning routine', 'productivity', 'habits'],
    },
    {
      id: 3,
      title: 'Why Your To-Do List is Making You Less Productive',
      hook: 'You finish your to-do list and feel accomplished. But your most important work didn\'t get done. Here\'s why.',
      potential: 79,
      angle: 'clarity',
      whyItWorks: [
        'Challenges a widely-held belief — creates cognitive dissonance',
        'Direct accusation-style title performs well in self-improvement niche',
        'Simple, specific claim is easy to understand at a glance',
      ],
      tags: ['productivity', 'focus', 'deep work'],
    },
    {
      id: 4,
      title: 'I Replaced My Phone With a Dumbphone for 30 Days',
      hook: 'Day 1: I felt completely lost. Day 7: Something strange started happening.',
      potential: 91,
      angle: 'curiosity',
      whyItWorks: [
        'Experiment format with implied transformation arc',
        'High shareability — polarizing topic with strong opinions',
        'Cliffhanger hook structure creates immediate watch obligation',
      ],
      tags: ['digital minimalism', 'phone', 'experiment'],
    },
  ],
  competitors: [
    {
      id: 5,
      title: 'The Study Method That Got Me Into Medical School',
      hook: 'I used this exact method for 6 months straight. My test scores went from average to top 5%.',
      potential: 85,
      angle: 'curiosity',
      whyItWorks: [
        'Credibility anchor (medical school) elevates perceived value',
        'Specific outcome claim (top 5%) makes promise concrete',
        'Study content performs evergreen — consistent long-tail traffic',
      ],
      tags: ['study techniques', 'learning', 'education'],
    },
    {
      id: 6,
      title: 'What Successful People Do in the First 60 Minutes of Their Day',
      hook: 'I analyzed 50 interviews with CEOs, athletes, and creators. A pattern nobody talks about kept appearing.',
      potential: 76,
      angle: 'clarity',
      whyItWorks: [
        'Data-backed angle increases credibility and shareability',
        'Time specificity (60 minutes) makes the promise feel achievable',
        'Aspirational framing (successful people) activates status drive',
      ],
      tags: ['morning routine', 'success habits', 'productivity'],
    },
  ],
  untapped: [
    {
      id: 7,
      title: 'The Productivity Advice That Only Works If You\'re Already Productive',
      hook: 'There\'s an uncomfortable truth about every popular productivity system that nobody wants to say out loud.',
      potential: 88,
      angle: 'curiosity',
      whyItWorks: [
        'Meta-commentary on a saturated niche — genuinely differentiates',
        'Contrarian claim creates immediate cognitive dissonance',
        'Low competition — few creators take this angle directly',
      ],
      tags: ['productivity critique', 'habits', 'systems thinking'],
    },
    {
      id: 8,
      title: 'Why I Stopped Trying to Be More Productive',
      hook: 'I spent three years optimizing every hour of my day. Then I realized I had optimized away everything that mattered.',
      potential: 83,
      angle: 'emotion',
      whyItWorks: [
        'Anti-productivity angle is underrepresented in the niche',
        'Emotional vulnerability drives high comment rates',
        'Shareability is very high — resonates with audience burnout',
      ],
      tags: ['burnout', 'intentional living', 'productivity'],
    },
    {
      id: 9,
      title: 'The Dark Side of 5am Routines Nobody Talks About',
      hook: 'I tracked every 5am creator for 6 months. The results were not what I expected.',
      potential: 90,
      angle: 'curiosity',
      whyItWorks: [
        '"Dark side" framing on popular topic performs extremely well',
        'Data-tracking angle adds credibility to contrarian claim',
        'Very low competition for this specific angle',
      ],
      tags: ['morning routines', 'critique', 'research'],
    },
  ],
};

const TAB_LABELS = [
  { id: 'trending',    label: 'Trending Now' },
  { id: 'competitors', label: 'Competitor Insights' },
  { id: 'untapped',   label: 'Untapped Opportunities' },
];

const ANGLE_COLORS = {
  curiosity: '#3b82f6',
  emotion:   '#ec4899',
  clarity:   '#22c55e',
};

function potentialColor(n) {
  return n >= 85 ? '#00c853' : n >= 75 ? '#ff9100' : '#ff1744';
}

function IdeaCard({ idea, onSelect, selected }) {
  return (
    <div
      onClick={() => onSelect(idea)}
      style={{
        background: selected ? '#0a0e14' : '#0e0e0e',
        border: `1px solid ${selected ? '#1a3a5e' : '#1a1a1a'}`,
        borderRadius: 12,
        padding: '16px 18px',
        cursor: 'pointer',
        transition: 'border-color 0.16s, background 0.16s',
      }}
      onMouseEnter={e => { if (!selected) { e.currentTarget.style.borderColor = '#2a2a2a'; e.currentTarget.style.background = '#111'; } }}
      onMouseLeave={e => { if (!selected) { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.background = '#0e0e0e'; } }}
    >
      {/* Angle + potential */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'capitalize', letterSpacing: '0.06em',
          background: (ANGLE_COLORS[idea.angle] || '#666') + '22',
          color: ANGLE_COLORS[idea.angle] || '#666',
          borderRadius: 4, padding: '2px 8px',
        }}>
          {idea.angle}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ fontSize: 11, color: '#444' }}>Potential</span>
          <span style={{ fontSize: 14, fontWeight: 800, color: potentialColor(idea.potential) }}>
            {idea.potential}
          </span>
        </div>
      </div>

      {/* Title */}
      <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', lineHeight: 1.5, marginBottom: 8 }}>
        {idea.title}
      </div>

      {/* Hook preview */}
      <div style={{ fontSize: 12, color: '#555', fontStyle: 'italic', lineHeight: 1.5, marginBottom: 12 }}>
        "{idea.hook.slice(0, 100)}{idea.hook.length > 100 ? '…' : ''}"
      </div>

      {/* Why it works */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {idea.whyItWorks.slice(0, 2).map((w, i) => (
          <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start' }}>
            <span style={{ color: '#3b82f6', fontSize: 11, marginTop: 2, flexShrink: 0 }}>↗</span>
            <span style={{ fontSize: 12, color: '#444', lineHeight: 1.4 }}>{w}</span>
          </div>
        ))}
      </div>

      {/* Tags */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {idea.tags.map(tag => (
          <span key={tag} style={{ fontSize: 10, color: '#333', background: '#1a1a1a', border: '1px solid #222', borderRadius: 4, padding: '2px 7px' }}>
            {tag}
          </span>
        ))}
      </div>
    </div>
  );
}

function DetailDrawer({ idea, onClose }) {
  if (!idea) return null;
  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: 400, background: '#0a0a0a', borderLeft: '1px solid #202020',
      zIndex: 100, overflowY: 'auto', padding: '24px 22px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#888' }}>Idea Detail</span>
        <button
          onClick={onClose}
          style={{ background: '#1a1a1a', border: '1px solid #282828', color: '#888', borderRadius: 6, padding: '5px 10px', fontSize: 12, cursor: 'pointer' }}
        >
          Close
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, textTransform: 'capitalize', letterSpacing: '0.06em',
          background: (ANGLE_COLORS[idea.angle] || '#666') + '22',
          color: ANGLE_COLORS[idea.angle] || '#666',
          borderRadius: 4, padding: '3px 8px',
        }}>
          {idea.angle}
        </span>
        <span style={{ fontSize: 16, fontWeight: 800, color: potentialColor(idea.potential) }}>
          {idea.potential}<span style={{ fontSize: 11, color: '#444', fontWeight: 400 }}> potential</span>
        </span>
      </div>

      <div style={{ fontSize: 16, fontWeight: 700, color: '#f0f0f0', lineHeight: 1.5, marginBottom: 16 }}>
        {idea.title}
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Hook</div>
        <div style={{ fontSize: 13, color: '#888', fontStyle: 'italic', lineHeight: 1.6, background: '#0e0e0e', border: '1px solid #1a1a1a', borderRadius: 8, padding: '12px 14px' }}>
          "{idea.hook}"
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Why It Works</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {idea.whyItWorks.map((w, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#0e1a0e', border: '1px solid #1a3a1a', color: '#00c853', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{i + 1}</span>
              <span style={{ fontSize: 13, color: '#777', lineHeight: 1.5 }}>{w}</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#333', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Tags</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {idea.tags.map(tag => (
            <span key={tag} style={{ fontSize: 11, color: '#555', background: '#141414', border: '1px solid #222', borderRadius: 4, padding: '3px 9px' }}>
              {tag}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function WhatToPost() {
  const [activeTab,  setActiveTab]  = useState('trending');
  const [query,      setQuery]      = useState('');
  const [selected,   setSelected]   = useState(null);

  const ideas = MOCK[activeTab] || [];
  const filtered = query
    ? ideas.filter(i =>
        i.title.toLowerCase().includes(query.toLowerCase()) ||
        i.tags.some(t => t.toLowerCase().includes(query.toLowerCase()))
      )
    : ideas;

  return (
    <div style={{ maxWidth: 860 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#f0f0f0', letterSpacing: '-0.5px', marginBottom: 6 }}>
          What to Post
        </div>
        <div style={{ color: '#555', fontSize: 14 }}>
          AI-sourced video ideas ranked by estimated performance potential.
        </div>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 20 }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter by topic, angle, or tag…"
          style={{
            width: '100%', maxWidth: 480, background: '#111', border: '1px solid #282828',
            borderRadius: 10, padding: '11px 16px', color: '#f0f0f0', fontSize: 14, outline: 'none',
          }}
          onFocus={e  => { e.target.style.borderColor = '#ff0000'; }}
          onBlur={e   => { e.target.style.borderColor = '#282828'; }}
        />
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 20, flexWrap: 'wrap' }}>
        {TAB_LABELS.map(tab => (
          <button
            key={tab.id}
            onClick={() => { setActiveTab(tab.id); setSelected(null); }}
            style={{
              background: activeTab === tab.id ? '#ff0000' : '#111',
              border: `1px solid ${activeTab === tab.id ? '#ff0000' : '#282828'}`,
              color: activeTab === tab.id ? '#fff' : '#666',
              borderRadius: 999, padding: '7px 16px', fontSize: 12,
              fontWeight: activeTab === tab.id ? 700 : 400,
              cursor: 'pointer', transition: 'all 0.16s',
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Coming soon notice */}
      <div style={{ marginBottom: 20, padding: '10px 14px', background: '#0e0e00', border: '1px solid #2a2a00', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 12 }}>⚡</span>
        <span style={{ fontSize: 12, color: '#888' }}>Live AI engine coming soon. Showing curated example ideas.</span>
      </div>

      {/* Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 14 }}>
        {filtered.length === 0 ? (
          <div style={{ gridColumn: '1/-1', color: '#444', fontSize: 14, padding: '20px 0' }}>
            No ideas match "{query}".
          </div>
        ) : filtered.map(idea => (
          <IdeaCard
            key={idea.id}
            idea={idea}
            onSelect={setSelected}
            selected={selected?.id === idea.id}
          />
        ))}
      </div>

      <DetailDrawer idea={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
