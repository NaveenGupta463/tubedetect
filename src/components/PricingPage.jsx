import { useState } from 'react';

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    color: '#888',
    icon: '🎯',
    desc: 'Explore your channel with basic stats.',
    priceINR: '₹0',
    priceUSD: '$0',
    periodINR: 'forever',
    periodUSD: 'forever',
    features: [
      { text: '5 AI analyses per month',    included: true  },
      { text: '1 channel analysis',         included: true  },
      { text: 'Basic stats & charts',       included: true  },
      { text: 'Upload cadence tracker',     included: true  },
      { text: 'Best time to post',          included: true  },
      { text: 'SEO tag analyzer',           included: true  },
      { text: '1 saved workspace',          included: true  },
      { text: 'Competitor comparison',      included: false },
      { text: 'AI Viral Formula Decoder',   included: false },
      { text: 'Comment Sentiment Miner',    included: false },
      { text: 'AI Script Generator',        included: false },
      { text: 'PDF report export',          included: false },
    ],
    cta: 'Get Started Free',
  },
  {
    id: 'starter',
    name: 'Starter',
    color: '#2196f3',
    icon: '⚡',
    desc: 'For creators ready to level up.',
    priceINR: '₹499',
    priceUSD: '$6',
    periodINR: 'per month',
    periodUSD: 'per month',
    features: [
      { text: 'Everything in Free',               included: true  },
      { text: '500 AI analyses per month',        included: true  },
      { text: '3 channel comparisons',            included: true  },
      { text: 'AI Viral Formula Decoder',         included: true  },
      { text: 'Title & Thumbnail Scorer',         included: true  },
      { text: 'Comment Sentiment Miner',          included: true  },
      { text: 'Niche Trend Scanner',              included: true  },
      { text: '6 saved workspaces',               included: true  },
      { text: 'Basic PDF reports',                included: true  },
      { text: 'AI Script Generator',              included: false },
      { text: 'Growth Prediction',                included: false },
      { text: 'Priority support',                 included: false },
    ],
    cta: 'Upgrade to Starter',
  },
  {
    id: 'pro',
    name: 'Pro',
    color: '#ff9100',
    icon: '🚀',
    desc: 'For serious creators who want every edge.',
    priceINR: '₹999',
    priceUSD: '$12',
    periodINR: 'per month',
    periodUSD: 'per month',
    highlighted: true,
    badge: 'Most Popular',
    features: [
      { text: 'Everything in Starter',            included: true },
      { text: '2000 AI analyses per month',       included: true },
      { text: 'Unlimited channel comparisons',    included: true },
      { text: 'AI Script Generator',              included: true },
      { text: 'Growth Prediction',                included: true },
      { text: 'Advanced PDF reports',             included: true },
      { text: '20 saved workspaces',              included: true },
      { text: 'Priority support',                 included: true },
      { text: 'White-label reports',              included: false },
      { text: 'Dedicated support',                included: false },
    ],
    cta: 'Upgrade to Pro',
  },
  {
    id: 'agency',
    name: 'Agency',
    color: '#00c853',
    icon: '🏢',
    desc: 'For agencies managing multiple channels.',
    priceINR: '₹2499',
    priceUSD: '$30',
    periodINR: 'per month',
    periodUSD: 'per month',
    features: [
      { text: 'Everything in Pro',                included: true },
      { text: 'Unlimited AI analyses',            included: true },
      { text: 'Unlimited channels',               included: true },
      { text: '10 client workspaces',             included: true },
      { text: 'White-label reports',              included: true },
      { text: 'Dedicated support',                included: true },
      { text: 'Custom integrations',              included: true },
      { text: 'Team collaboration (coming soon)', included: true },
    ],
    cta: 'Upgrade to Agency',
  },
];

const COMPARE_FEATURES = [
  { label: 'AI Analyses / Month',          free: '5',      starter: '500',       pro: '2,000',   agency: '∞'       },
  { label: 'Channel Comparisons',          free: false,    starter: '3',         pro: '∞',       agency: '∞'       },
  { label: 'Saved Workspaces',             free: '1',      starter: '6',         pro: '20',      agency: '∞'       },
  { label: 'Basic Analytics',             free: true,     starter: true,        pro: true,      agency: true      },
  { label: 'Viral Formula Decoder',        free: false,    starter: true,        pro: true,      agency: true      },
  { label: 'Title & Thumbnail Scorer',     free: false,    starter: true,        pro: true,      agency: true      },
  { label: 'Comment Sentiment Miner',      free: false,    starter: true,        pro: true,      agency: true      },
  { label: 'Niche Trend Scanner',          free: false,    starter: true,        pro: true,      agency: true      },
  { label: 'AI Script Generator',          free: false,    starter: false,       pro: true,      agency: true      },
  { label: 'Growth Prediction',            free: false,    starter: false,       pro: true,      agency: true      },
  { label: 'PDF Report Export',            free: false,    starter: 'Basic',     pro: 'Advanced',agency: 'White-label'},
  { label: 'Priority Support',             free: false,    starter: false,       pro: true,      agency: true      },
  { label: 'Dedicated Support',            free: false,    starter: false,       pro: false,     agency: true      },
  { label: 'Custom Integrations',          free: false,    starter: false,       pro: false,     agency: true      },
];

function FeatVal({ val }) {
  if (val === true)  return <span style={{ color: '#00c853', fontWeight: 700 }}>✓</span>;
  if (val === false) return <span style={{ color: '#2a2a2a' }}>—</span>;
  return <span style={{ color: '#aaa', fontSize: 12, fontWeight: 600 }}>{val}</span>;
}

function PriceDisplay({ plan, currency }) {
  const price  = currency === 'INR' ? plan.priceINR  : plan.priceUSD;
  const period = currency === 'INR' ? plan.periodINR : plan.periodUSD;
  return (
    <div className="pricing-price" style={{ minHeight: 52 }}>
      <span
        className="pricing-amount"
        style={{ transition: 'opacity 0.25s ease, transform 0.25s ease' }}
      >
        {price}
      </span>
      <span className="pricing-period">/{period}</span>
    </div>
  );
}

export default function PricingPage({ currentTier, onSelectTier }) {
  const [currency, setCurrency] = useState('INR');

  return (
    <div className="feature-page pricing-page">
      <div className="feature-header" style={{ textAlign: 'center' }}>
        <h2 className="feature-title" style={{ fontSize: 32 }}>Choose Your Plan</h2>
        <p className="feature-desc" style={{ maxWidth: 520, margin: '0 auto 16px' }}>
          All plans include the full YouTube Data API integration.
          AI features use TubeIntel for deep content intelligence.
        </p>

        {/* Currency Toggle */}
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 0, background: '#1a1a1a', border: '1px solid #2a2a2a', borderRadius: 10, padding: 4, marginBottom: 8 }}>
          {['INR', 'USD'].map(c => (
            <button
              key={c}
              onClick={() => setCurrency(c)}
              style={{
                padding: '7px 22px',
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 700,
                border: 'none',
                cursor: 'pointer',
                transition: 'background 0.2s ease, color 0.2s ease',
                background: currency === c ? '#ff9100' : 'transparent',
                color:      currency === c ? '#000'    : '#666',
              }}
            >
              {c === 'INR' ? '₹ INR' : '$ USD'}
            </button>
          ))}
        </div>

        <div className="demo-note">
          🧪 Demo Mode — clicking Upgrade instantly unlocks features without payment
        </div>
      </div>

      {/* Plan Cards */}
      <div className="pricing-cards">
        {PLANS.map(plan => {
          const isCurrent = currentTier === plan.id;
          return (
            <div
              key={plan.id}
              className={`pricing-card ${plan.highlighted ? 'pricing-card-highlight' : ''} ${isCurrent ? 'pricing-card-current' : ''}`}
              style={plan.highlighted ? { borderColor: plan.color } : {}}
            >
              {plan.badge && !isCurrent && (
                <div className="pricing-badge" style={{ background: plan.color }}>
                  {plan.badge}
                </div>
              )}
              {isCurrent && (
                <div className="pricing-badge" style={{ background: '#333', color: '#fff' }}>
                  Current Plan
                </div>
              )}

              <div className="pricing-icon">{plan.icon}</div>
              <div className="pricing-name" style={{ color: plan.color }}>{plan.name}</div>

              <PriceDisplay plan={plan} currency={currency} />

              <div className="pricing-desc">{plan.desc}</div>

              <div className="pricing-features">
                {plan.features.map((f, i) => (
                  <div key={i} className={`pricing-feature ${f.included ? '' : 'pricing-feature-excluded'}`}>
                    <span>{f.included ? '✓' : '✗'}</span>
                    <span>{f.text}</span>
                  </div>
                ))}
              </div>

              <button
                className={`btn-primary pricing-cta ${isCurrent ? 'btn-ghost' : ''}`}
                style={plan.highlighted && !isCurrent ? { background: plan.color, borderColor: plan.color } : {}}
                onClick={() => !isCurrent && onSelectTier(plan.id)}
                disabled={isCurrent}
              >
                {isCurrent ? 'Current Plan ✓' : plan.cta}
              </button>
            </div>
          );
        })}
      </div>

      {/* Currency note */}
      <div style={{ textAlign: 'center', marginTop: 12, fontSize: 12, color: '#555' }}>
        INR pricing for Indian creators · USD pricing for international subscribers
      </div>

      {/* Feature Comparison Table */}
      <div className="chart-card" style={{ marginTop: 32 }}>
        <h3 className="chart-title">Full Feature Comparison</h3>
        <div className="table-wrap">
          <table className="video-table">
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '12px 14px', fontSize: 11, color: '#666' }}>Feature</th>
                {PLANS.map(p => (
                  <th key={p.id} className="th-num" style={{ color: p.color }}>{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {COMPARE_FEATURES.map(f => (
                <tr key={f.label} className="video-row">
                  <td style={{ padding: '10px 14px', fontSize: 13, color: '#ccc' }}>{f.label}</td>
                  <td className="td-num"><FeatVal val={f.free} /></td>
                  <td className="td-num"><FeatVal val={f.starter} /></td>
                  <td className="td-num"><FeatVal val={f.pro} /></td>
                  <td className="td-num"><FeatVal val={f.agency} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ textAlign: 'center', marginTop: 24, color: '#555', fontSize: 13 }}>
        Questions? Contact us at support@tubeintel.app · Cancel anytime
      </div>
    </div>
  );
}
