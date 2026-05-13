import { motion } from 'framer-motion';
import { variants, spring } from './spring';

export default function MotionCard({ children, style, className, onClick, delay = 0, ...props }) {
  return (
    <motion.div
      variants={variants.slideUp}
      initial="hidden"
      animate="visible"
      exit="exit"
      whileHover={variants.hover.card}
      transition={{ ...spring.smooth, delay }}
      style={{ willChange: 'transform', ...style }}
      className={className}
      onClick={onClick}
      {...props}
    >
      {children}
    </motion.div>
  );
}
