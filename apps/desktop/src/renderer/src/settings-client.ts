import type { AppSettingsPatch, ProjectSettingsPatch } from '@arbora/shared';
import { showToast, useApp } from './store';

export async function updateSettings(patch: AppSettingsPatch): Promise<void> {
  try {
    const settings = await window.arbora.invoke('settings.update', patch);
    useApp.setState({ settings });
  } catch (error) {
    showToast(`Could not save the setting: ${(error as Error).message}`);
  }
}

/** Writes `.arbora/project.json` fields; the window's project info follows. */
export async function updateProjectSettings(patch: ProjectSettingsPatch): Promise<boolean> {
  try {
    const project = await window.arbora.invoke('project.updateSettings', patch);
    useApp.setState({ project });
    return true;
  } catch (error) {
    showToast(`Could not save project settings: ${(error as Error).message}`);
    return false;
  }
}
