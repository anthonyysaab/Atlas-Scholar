import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  leaving?: boolean;
}

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => string;
  dismiss: (id: string) => void;
}

const LIFETIME_MS: Record<ToastKind, number> = { info: 3500, success: 3500, error: 6500 };
export const TOAST_EXIT_MS = 160;

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (kind, message) => {
    const id = crypto.randomUUID();
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismiss(id), LIFETIME_MS[kind]);
    return id;
  },

  dismiss: (id) => {
    const target = get().toasts.find((toast) => toast.id === id);
    if (!target || target.leaving) return;
    set((state) => ({ toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)) }));
    setTimeout(
      () => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
      TOAST_EXIT_MS
    );
  }
}));

export const toast = {
  info: (message: string): string => useToastStore.getState().push("info", message),
  success: (message: string): string => useToastStore.getState().push("success", message),
  error: (message: string): string => useToastStore.getState().push("error", message),
  dismiss: (id: string): void => useToastStore.getState().dismiss(id)
};
