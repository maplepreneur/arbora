/**
 * Which title-bar groups fold down to the active option. Widths are measured, including the
 * project name at its natural size, so a long name collapses the controls in a window where a
 * short name still fits. `0` means that group is not on screen, or the bar has not been measured.
 */
export interface TitleBarWidths {
  /** Title bar inner width. */
  readonly bar: number;
  /** Traffic-light spacer, attention bell, and window controls. */
  readonly chrome: number;
  /** Logo, app name, project name, and expanded mode pills. */
  readonly leftExpanded: number;
  /** The same left cluster with the collapsed mode control. `0` when mode pills are hidden. */
  readonly leftCollapsed: number;
  /** Expanded Browser / Grove switch. `0` when the switch is hidden. */
  readonly workspaceExpanded: number;
  /** Collapsed workspace control. `0` when the switch is hidden. */
  readonly workspaceCollapsed: number;
}

/** Empty space kept between the mode group and the workspace group. */
export const TITLE_BAR_GROUP_GAP = 8;

export interface TitleBarCollapse {
  readonly mode: boolean;
  readonly workspace: boolean;
}

const EXPANDED: TitleBarCollapse = { mode: false, workspace: false };

/**
 * Collapses a group only when the expanded controls do not fit in the bar. When either collapse
 * would be enough, the group that frees more width collapses and the other stays expanded.
 */
export function chooseTitleBarCollapses(w: TitleBarWidths): TitleBarCollapse {
  const workspaceUnmeasured = w.workspaceExpanded > 0 && w.workspaceCollapsed <= 0;
  if (w.bar <= 0 || w.leftExpanded <= 0 || workspaceUnmeasured) return EXPANDED;

  const modes = w.leftCollapsed > 0;
  const workspaces = w.workspaceExpanded > 0;
  const gap = modes && workspaces ? TITLE_BAR_GROUP_GAP : 0;
  const budget = w.bar - w.chrome - gap;
  const leftExpanded = w.leftExpanded;
  const leftCollapsed = modes ? w.leftCollapsed : leftExpanded;
  const workspaceExpanded = workspaces ? w.workspaceExpanded : 0;
  const workspaceCollapsed = workspaces ? w.workspaceCollapsed : 0;

  if (leftExpanded + workspaceExpanded <= budget) return EXPANDED;
  if (!modes && !workspaces) return EXPANDED;
  if (!modes) return { mode: false, workspace: true };
  if (!workspaces) return { mode: true, workspace: false };

  const modeOnly = leftCollapsed + workspaceExpanded <= budget;
  const workspaceOnly = leftExpanded + workspaceCollapsed <= budget;
  if (modeOnly && !workspaceOnly) return { mode: true, workspace: false };
  if (workspaceOnly && !modeOnly) return { mode: false, workspace: true };
  if (modeOnly && workspaceOnly) {
    const modeSaves = leftExpanded - leftCollapsed;
    const workspaceSaves = workspaceExpanded - workspaceCollapsed;
    return modeSaves >= workspaceSaves ? { mode: true, workspace: false } : { mode: false, workspace: true };
  }
  return { mode: true, workspace: true };
}
