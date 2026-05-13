import { motion } from 'framer-motion';
import { variants, stagger } from './spring';

export default function MotionContainer({ children, style, className, speed = 'base', delay = 0 }) {
  return (
    <motion.div
      variants={variants.container}
      initial="hidden"
      animate="visible"
      transition={{ ...stagger[speed], delayChildren: delay }}
      style={style}
      className={className}
    >
      {children}
    </motion.div>
  );
}
