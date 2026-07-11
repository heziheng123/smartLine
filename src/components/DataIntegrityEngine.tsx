import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Archive, Undo2, X, ShieldAlert } from 'lucide-react';
import { useDataIntegrityStore } from '@/store/dataIntegrity';
import { HealthCenterPanel } from './HealthCenterPanel';

export const DataIntegrityEngine: React.FC = () => {
  const { toast, hideToast, healthPanelOpen } = useDataIntegrityStore();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (toast?.isOpen) {
      setIsVisible(true);
      // Auto-hide after 10 seconds if no action taken
      const timer = setTimeout(() => {
        setIsVisible(false);
        setTimeout(hideToast, 300); // Wait for exit animation
      }, 10000);
      return () => clearTimeout(timer);
    } else {
      setIsVisible(false);
    }
  }, [toast, hideToast]);

  const handleConfirm = () => {
    if (toast?.onConfirm) toast.onConfirm();
    setIsVisible(false);
    setTimeout(hideToast, 300);
  };

  const handleUndo = () => {
    if (toast?.onUndo) toast.onUndo();
    setIsVisible(false);
    setTimeout(hideToast, 300);
  };

  const handleClose = () => {
    setIsVisible(false);
    setTimeout(hideToast, 300);
  };

  return (
    <>
      {/* Health Center Panel */}
      <HealthCenterPanel />

      {/* Original Toast Notification */}
      <AnimatePresence>
        {isVisible && toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-4 bg-slate-900/90 backdrop-blur-xl text-white px-5 py-3 rounded-2xl shadow-2xl border border-slate-700/50 pointer-events-auto"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                <ShieldAlert size={16} />
              </div>
              <p className="text-[13px] font-medium leading-relaxed max-w-[300px]">
                {toast.message}
              </p>
            </div>

            <div className="w-px h-8 bg-slate-700/50 mx-1"></div>

            <div className="flex items-center gap-2">
              {toast.onConfirm && (
                <button
                  onClick={handleConfirm}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-500 hover:bg-blue-400 text-white text-xs font-semibold transition-colors"
                >
                  <Archive size={14} />
                  <span>一键归档</span>
                </button>
              )}
              {toast.onUndo && (
                <button
                  onClick={handleUndo}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs font-semibold border border-slate-700 hover:border-slate-600 transition-all"
                >
                  <Undo2 size={14} />
                  <span>撤销</span>
                </button>
              )}
              <button
                onClick={handleClose}
                className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800 rounded-lg ml-1 transition-colors"
              >
                <X size={14} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
};
