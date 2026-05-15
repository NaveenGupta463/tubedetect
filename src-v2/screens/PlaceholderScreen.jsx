import { motion } from 'framer-motion';
import { T, ease } from '../tokens';

export default function PlaceholderScreen({ meta }) {
  if (!meta) return null;
  const { icon: Icon, title, sub } = meta;

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease }}
      style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 18,
        padding: 40,
      }}
    >
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        background: T.card, border: `1px solid ${T.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: T.subtle,
      }}>
        <Icon size={24} color="currentColor" />
      </div>

      <div style={{ textAlign: 'center', maxWidth: 380 }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: T.text, marginBottom: 8 }}>{title}</div>
        <div style={{ fontSize: '0.84rem', color: T.muted, lineHeight: 1.6 }}>{sub}</div>
      </div>

      <div style={{
        marginTop: 8,
        fontSize: '0.72rem', fontWeight: 600, color: T.accent,
        background: T.accentGlow, border: `1px solid ${T.accentBorder}`,
        borderRadius: 8, padding: '6px 16px',
      }}>
        Coming soon
      </div>
    </motion.div>
  );
}
