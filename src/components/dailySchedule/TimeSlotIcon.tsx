import React from 'react';
import { Moon, Sun, Sunrise } from 'lucide-react';
import type { TimeSlot } from './types';

interface TimeSlotIconProps {
  slot: TimeSlot;
  size?: number;
}

const TimeSlotIcon: React.FC<TimeSlotIconProps> = ({ slot, size = 16 }) => {
  if (slot === 'morning') return <Sunrise size={size} aria-hidden="true" />;
  if (slot === 'afternoon') return <Sun size={size} aria-hidden="true" />;
  return <Moon size={size} aria-hidden="true" />;
};

export default TimeSlotIcon;
