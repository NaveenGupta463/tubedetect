import { motion } from 'framer-motion';
import { variants, stagger } from './spring';

export default function MotionList({ children, style, className, speed = 'list' }) {
  return (
    <motion.ul
      variants={{ hidden: {}, visible: { transition: stagger[speed] } }}
      initial="hidden"
      animate="visible"
      style={{ listStyle: 'none', padding: 0, margin: 0, ...style }}
      className={className}
    >
      {children}
    </motion.ul>
  );
}

export function MotionListItem({ children, style, className, ...props }) {
  return (
    <motion.li
      variants={variants.listItem}
      style={style}
      className={className}
      {...props}
    >
      {children}
    </motion.li>
  );
}
