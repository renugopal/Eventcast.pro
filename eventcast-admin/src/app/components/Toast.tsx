"use client";

import { useState, useCallback, useEffect, createContext, useContext, useRef } from "react";
import { CheckCircle2, AlertCircle, Info, X, AlertTriangle } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = "success" | "error" | "info" | "warning";

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, default 4000; 0 = persistent
}

interface ToastContextValue {
  toast: (opts: Omit<Toast, "id">) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}

// ─── Individual Toast Component ───────────────────────────────────────────────

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-emerald-400 flex-shrink-0" />,
  error:   <AlertCircle  size={18} className="text-red-400    flex-shrink-0" />,
  warning: <AlertTriangle size={18} className="text-amber-400 flex-shrink-0" />,
  info:    <Info         size={18} className="text-blue-400   flex-shrink-0" />,
};

const STYLES: Record<ToastType, string> = {
  success: "border-emerald-500/20 bg-emerald-500/[0.06] shadow-emerald-500/10",
  error:   "border-red-500/20    bg-red-500/[0.06]    shadow-red-500/10",
  warning: "border-amber-500/20  bg-amber-500/[0.06]  shadow-amber-500/10",
  info:    "border-blue-500/20   bg-blue-500/[0.06]   shadow-blue-500/10",
};

const PROGRESS_COLORS: Record<ToastType, string> = {
  success: "bg-emerald-400",
  error:   "bg-red-400",
  warning: "bg-amber-400",
  info:    "bg-blue-400",
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: (id: string) => void }) {
  const [visible, setVisible] = useState(false);
  const [progress, setProgress] = useState(100);
  const duration = toast.duration ?? 4000;
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Mount animation
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 10);
    return () => clearTimeout(t);
  }, []);

  // Progress bar + auto-dismiss
  useEffect(() => {
    if (duration === 0) return; // persistent
    const step = 50; // update every 50ms
    const decrement = (step / duration) * 100;
    intervalRef.current = setInterval(() => {
      setProgress((prev) => {
        if (prev <= 0) {
          clearInterval(intervalRef.current!);
          handleDismiss();
          return 0;
        }
        return prev - decrement;
      });
    }, step);
    return () => clearInterval(intervalRef.current!);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duration]);

  function handleDismiss() {
    setVisible(false);
    setTimeout(() => onDismiss(toast.id), 300);
  }

  return (
    <div
      className={`relative w-full max-w-sm overflow-hidden rounded-2xl border backdrop-blur-2xl shadow-2xl transition-all duration-300 ${STYLES[toast.type]} ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="flex items-start gap-3 p-4">
        {ICONS[toast.type]}
        <div className="flex-1 min-w-0">
          <p className="text-white text-sm font-black tracking-tight leading-snug">
            {toast.title}
          </p>
          {toast.message && (
            <p className="text-white/50 text-xs font-medium mt-0.5 leading-relaxed">
              {toast.message}
            </p>
          )}
        </div>
        <button
          onClick={handleDismiss}
          className="text-white/20 hover:text-white/60 transition-colors flex-shrink-0 mt-0.5"
        >
          <X size={14} />
        </button>
      </div>

      {/* Progress bar */}
      {duration > 0 && (
        <div className="h-0.5 w-full bg-white/5">
          <div
            className={`h-full transition-none ${PROGRESS_COLORS[toast.type]}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Provider + Container ─────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback((opts: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { ...opts, id }]); // max 5 visible
  }, []);

  const success = useCallback((title: string, message?: string) =>
    toast({ type: "success", title, message }), [toast]);
  const error = useCallback((title: string, message?: string) =>
    toast({ type: "error", title, message, duration: 6000 }), [toast]);
  const info = useCallback((title: string, message?: string) =>
    toast({ type: "info", title, message }), [toast]);
  const warning = useCallback((title: string, message?: string) =>
    toast({ type: "warning", title, message }), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, warning, dismiss }}>
      {children}

      {/* Toast Container — fixed bottom-right */}
      <div className="fixed bottom-6 right-6 z-[9999] flex flex-col gap-3 items-end pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto w-full max-w-sm">
            <ToastItem toast={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── AlertDialog (replaces confirm()) ────────────────────────────────────────

interface AlertDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function AlertDialog({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}: AlertDialogProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[9998] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onCancel}
      />

      {/* Dialog */}
      <div
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 backdrop-blur-2xl shadow-2xl p-8 animate-in fade-in zoom-in-95 duration-200"
        style={{ background: "rgba(10,10,20,0.92)" }}
      >
        {/* Icon */}
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${
          danger ? "bg-red-500/10 border border-red-500/20" : "bg-amber-500/10 border border-amber-500/20"
        }`}>
          <AlertTriangle size={26} className={danger ? "text-red-400" : "text-amber-400"} />
        </div>

        <h3 className="text-xl font-black text-white tracking-tight mb-2">{title}</h3>
        <p className="text-white/40 text-sm font-medium leading-relaxed mb-8">{message}</p>

        <div className="flex gap-3">
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 bg-white/5 hover:bg-white/10 text-white/60 hover:text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 py-3.5 rounded-2xl font-black text-sm uppercase tracking-wider transition-all ${
              danger
                ? "bg-red-600 hover:bg-red-500 text-white shadow-[0_10px_30px_-10px_rgba(239,68,68,0.5)]"
                : "bg-amber-500 hover:bg-amber-400 text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.5)]"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
