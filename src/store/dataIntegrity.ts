import { create } from 'zustand';
import { useGraphStore } from '@/graph/store';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';

interface DataIntegrityStore {
  toast: {
    isOpen: boolean;
    message: string;
    onConfirm?: () => void;
    onUndo?: () => void;
  } | null;
  showToast: (message: string, onConfirm?: () => void, onUndo?: () => void) => void;
  hideToast: () => void;
}

export const useDataIntegrityStore = create<DataIntegrityStore>((set) => ({
  toast: null,
  showToast: (message, onConfirm, onUndo) => set({ toast: { isOpen: true, message, onConfirm, onUndo } }),
  hideToast: () => set({ toast: null }),
}));