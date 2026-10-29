/**
 * Browser bridge: CDP helpers, inspector/design overlays, framework detection and source resolution.
 * Implemented in Stages 1, 4 and 6 (see docs/BUILD_STAGES.md).
 */

/** Private IPC prefix used between `browser-preload` and main. */
export const PAGE_CHANNEL_PREFIX = 'arbora:page:';
