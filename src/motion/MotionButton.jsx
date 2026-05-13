import { motion } from 'framer-motion';
import { variants, spring } from './spring';

export default function MotionButton({ children, style, className, onClick, disabled, type = 'button', ...props }) {
  return (
    <motion.button
      type={type}
      whileHover={disabled ? undefined : variants.hover.button}
      whileTap={disabled ? undefined : variants.tap.button}
      transition={spring.snappy}
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
      className={className}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </motion.button>
  );
}
