import type { ArboraBridge } from '@arbora/shared';

declare global {
  interface Window {
    readonly arbora: ArboraBridge;
  }
}
