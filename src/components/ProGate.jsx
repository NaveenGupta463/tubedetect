import { meetsRequirement } from '../utils/tierConfig';

export default function ProGate({ tier, required = 'pro', onUpgrade, children }) {
  if (meetsRequirement(tier, required)) return children;

  const label = required === 'agency' ? 'Agency' : 'Pro';
  const price = required === 'agency' ? '$49/mo' : '$19/mo';

  return (
    <div className="pro-gate">
      <div className="pro-gate-icon">🔒</div>
      <h3 className="pro-gate-title">{label} Feature</h3>
      <p className="pro-gate-desc">
        This feature requires a <strong>{label}</strong> plan ({price}).
        Upgrade to unlock AI-powered analysis, competitor comparison, and more.
      </p>
      <button className="btn-upgrade" onClick={onUpgrade}>
        View Plans — Upgrade to {label}
      </button>
    </div>
  );
}
