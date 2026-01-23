"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  variant?: "default" | "success" | "error";
};

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = createContext<ToastState | undefined>(undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Date.now());
    setToasts((prev) => [...prev, { id, ...toast }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, 4500);
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const contextValue = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`w-72 rounded-md border bg-white/90 p-3 shadow-xl backdrop-blur transition ${
              toast.variant === "error"
                ? "border-rose-300"
                : toast.variant === "success"
                ? "border-emerald-300"
                : "border-slate-200"
            }`}
          >
            <div className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-900">
              <span>{toast.title}</span>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="text-xs font-normal text-slate-500"
              >
                Dismiss
              </button>
            </div>
            {toast.description && (
              <p className="mt-1 text-xs text-slate-600">{toast.description}</p>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
