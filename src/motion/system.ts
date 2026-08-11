import type { Transition } from 'framer-motion';

/** Shared motion language for the entire workspace. */
export const MOTION_DURATION = {
  instant: 0.09,
  fast: 0.14,
  standard: 0.18,
  panel: 0.22,
  emphasis: 0.32,
  exit: 0.1,
} as const;

export const MOTION_EASE_ENTER = [0.22, 1, 0.36, 1] as const;
export const MOTION_EASE_EXIT = [0.4, 0, 1, 1] as const;

export const MOTION_TRANSITION_STANDARD = {
  duration: MOTION_DURATION.standard,
  ease: MOTION_EASE_ENTER,
} satisfies Transition;

export const MOTION_TRANSITION_PANEL = {
  duration: MOTION_DURATION.panel,
  ease: MOTION_EASE_ENTER,
} satisfies Transition;

export const MOTION_TRANSITION_EXIT = {
  duration: MOTION_DURATION.exit,
  ease: MOTION_EASE_EXIT,
} satisfies Transition;

/** A tightly damped spring: responsive without a decorative bounce. */
export const MOTION_SPRING_GENTLE = {
  type: 'spring',
  stiffness: 430,
  damping: 36,
  mass: 0.72,
} satisfies Transition;
