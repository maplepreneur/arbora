import type { Diagnostic } from '@arbora/shared';

/** Messages between main and the tooling utility process (`tooling-worker.js`). */
export type ToolRequest =
  | {
      readonly id: number;
      readonly type: 'format';
      readonly root: string;
      readonly file: string;
      readonly content: string;
    }
  | {
      readonly id: number;
      readonly type: 'lint';
      readonly root: string;
      readonly file: string;
      readonly content: string;
    };

export type ToolResponse =
  | { readonly id: number; readonly ok: true; readonly type: 'format'; readonly result: string | null }
  | { readonly id: number; readonly ok: true; readonly type: 'lint'; readonly result: Diagnostic[] | null }
  | { readonly id: number; readonly ok: false; readonly error: string };
