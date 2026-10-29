import type { ArboraBridge, CommandRegistry } from '@arbora/shared';
import { createContext, useContext, type ReactNode } from 'react';
import { useStore } from 'zustand';
import type { AppStore, AppStoreApi, Toast } from './store';

export interface AppServices {
  readonly store: AppStoreApi;
  readonly commands: CommandRegistry;
  readonly bridge: ArboraBridge;
}

const ServicesContext = createContext<AppServices | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: AppServices;
  children: ReactNode;
}) {
  return <ServicesContext value={services}>{children}</ServicesContext>;
}

export function useServices(): AppServices {
  const services = useContext(ServicesContext);
  if (!services) throw new Error('useServices must be used inside <ServicesProvider>');
  return services;
}

export function useAppState<T>(selector: (state: AppStore) => T): T {
  return useStore(useServices().store, selector);
}

let toastSeq = 0;
const TOAST_TIMEOUT_MS = 4000;

export function showToast(store: AppStoreApi, message: string, tone: Toast['tone'] = 'info'): void {
  const toast: Toast = { id: ++toastSeq, message, tone };
  store.setState((state) => ({ toasts: [...state.toasts, toast] }));
  setTimeout(() => {
    store.setState((state) => ({ toasts: state.toasts.filter((entry) => entry.id !== toast.id) }));
  }, TOAST_TIMEOUT_MS);
}
