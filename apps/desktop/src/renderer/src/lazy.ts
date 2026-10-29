// The only renderer module allowed to use dynamic `import()`: lazy boundaries for panels, so
// each panel's code (and later its heavy dependencies) loads only when the panel is shown.
import { lazy } from 'react';

export const BrowserPanel = lazy(() => import('./panels/BrowserPanel'));
export const AgentPanel = lazy(() => import('./panels/AgentPanel'));
export const SidebarPanel = lazy(() => import('./panels/SidebarPanel'));
export const BottomPanel = lazy(() => import('./panels/BottomPanel'));
