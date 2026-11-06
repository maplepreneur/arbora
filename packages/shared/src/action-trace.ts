import { z } from 'zod';

/** Newest steps kept on a thread. Older ones fall off so a long session cannot fill the thread file. */
export const ACTION_TRACE_STEP_LIMIT = 12;
/** Base64 thumbnail cap. A viewport JPEG at 240px stays well under this. */
export const ACTION_TRACE_IMAGE_LIMIT = 400_000;

export const actionTraceImageSchema = z.object({
  data: z.string().max(ACTION_TRACE_IMAGE_LIMIT),
  mimeType: z.string().max(64),
  width: z.number().int().nonnegative(),
  height: z.number().int().nonnegative(),
});
export type ActionTraceImage = z.infer<typeof actionTraceImageSchema>;

export const actionTraceStepSchema = z.object({
  id: z.string().min(1),
  at: z.number().int(),
  tool: z.string().max(80),
  title: z.string().max(160),
  ok: z.boolean(),
  /** Set when the tool returned an error. */
  error: z.string().max(300).nullable(),
  /** Viewport thumbnail taken after the tool returned. Null when the page could not be captured. */
  image: actionTraceImageSchema.nullable(),
  /** Project-relative path of a saved compare image, when this step is a compare. */
  path: z.string().max(400).nullable().optional(),
});
export type ActionTraceStep = z.infer<typeof actionTraceStepSchema>;

/** Appends `step` and drops the oldest entries past the limit. */
export function pushTraceStep(steps: readonly ActionTraceStep[], step: ActionTraceStep): ActionTraceStep[] {
  const next = [...steps, step];
  return next.length > ACTION_TRACE_STEP_LIMIT ? next.slice(next.length - ACTION_TRACE_STEP_LIMIT) : next;
}
