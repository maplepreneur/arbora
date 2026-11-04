import { describe, expect, it } from 'vitest';
import { chooseTitleBarCollapses, TITLE_BAR_GROUP_GAP, type TitleBarWidths } from './title-bar-collapse';

const chrome = 80;
const gap = TITLE_BAR_GROUP_GAP;

/** Short project name: mode pills save more width than the workspace switch. */
function shortName(): Pick<
  TitleBarWidths,
  'chrome' | 'leftExpanded' | 'leftCollapsed' | 'workspaceExpanded' | 'workspaceCollapsed'
> {
  return {
    chrome,
    leftExpanded: 360,
    leftCollapsed: 240,
    workspaceExpanded: 150,
    workspaceCollapsed: 90,
  };
}

describe('chooseTitleBarCollapses', () => {
  it('keeps both groups expanded when they fit beside the project name', () => {
    const widths = shortName();
    const bar = widths.chrome + widths.leftExpanded + widths.workspaceExpanded + gap;
    expect(chooseTitleBarCollapses({ ...widths, bar })).toEqual({ mode: false, workspace: false });
  });

  it('stays expanded until the bar has been measured', () => {
    expect(chooseTitleBarCollapses({ ...shortName(), bar: 0 })).toEqual({ mode: false, workspace: false });
    expect(chooseTitleBarCollapses({ ...shortName(), bar: 800, leftExpanded: 0 })).toEqual({
      mode: false,
      workspace: false,
    });
  });

  it('collapses only the mode pills when that frees enough room', () => {
    const widths = shortName();
    const both = widths.chrome + widths.leftExpanded + widths.workspaceExpanded + gap;
    const modeCollapsed = widths.chrome + widths.leftCollapsed + widths.workspaceExpanded + gap;
    expect(modeCollapsed).toBeLessThan(both);
    expect(chooseTitleBarCollapses({ ...widths, bar: both - 1 })).toEqual({ mode: true, workspace: false });
  });

  it('collapses only the workspace switch when the mode pills are the narrower group', () => {
    const widths: TitleBarWidths = {
      bar: 500,
      chrome,
      leftExpanded: 300,
      leftCollapsed: 250,
      workspaceExpanded: 220,
      workspaceCollapsed: 80,
    };
    expect(chooseTitleBarCollapses(widths)).toEqual({ mode: false, workspace: true });
  });

  it('collapses both groups when neither single collapse fits', () => {
    const widths = shortName();
    expect(chooseTitleBarCollapses({ ...widths, bar: 400 })).toEqual({ mode: true, workspace: true });
  });

  it('collapses sooner for a long project name in the same window', () => {
    const widths = shortName();
    const bar = widths.chrome + widths.leftExpanded + widths.workspaceExpanded + gap;
    expect(chooseTitleBarCollapses({ ...widths, bar })).toEqual({ mode: false, workspace: false });
    const longer = {
      ...widths,
      bar,
      leftExpanded: widths.leftExpanded + 200,
      leftCollapsed: widths.leftCollapsed + 200,
    };
    expect(chooseTitleBarCollapses(longer)).toEqual({ mode: true, workspace: true });
  });

  it('collapses the workspace switch alone when mode pills are not shown', () => {
    expect(
      chooseTitleBarCollapses({
        bar: 200,
        chrome: 40,
        leftExpanded: 80,
        leftCollapsed: 0,
        workspaceExpanded: 150,
        workspaceCollapsed: 70,
      }),
    ).toEqual({ mode: false, workspace: true });
  });

  it('collapses mode pills alone when the workspace switch is not shown', () => {
    expect(
      chooseTitleBarCollapses({
        bar: 200,
        chrome: 40,
        leftExpanded: 220,
        leftCollapsed: 100,
        workspaceExpanded: 0,
        workspaceCollapsed: 0,
      }),
    ).toEqual({ mode: true, workspace: false });
  });
});
