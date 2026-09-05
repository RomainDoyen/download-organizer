import { browser } from 'wxt/browser';

export const SORT_ENABLED_KEY = 'sortDownloadsEnabled' as const;
export const ARCHIVE_FOLDER_KEY = 'archiveFolder' as const;
export const PREVIEW_ENABLED_KEY = 'previewEnabled' as const;
export const LAZY_PREVIEW_KEY = 'lazyPreviewEnabled' as const;

export async function isSortingEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(SORT_ENABLED_KEY);
  return r[SORT_ENABLED_KEY] !== false;
}

export async function setSortingEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SORT_ENABLED_KEY]: enabled });
}

export async function getArchiveFolder(): Promise<string> {
  const r = await browser.storage.local.get(ARCHIVE_FOLDER_KEY);
  return r[ARCHIVE_FOLDER_KEY] || 'Archives';
}

export async function setArchiveFolder(folder: string): Promise<void> {
  await browser.storage.local.set({ [ARCHIVE_FOLDER_KEY]: folder });
}

export async function isPreviewEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(PREVIEW_ENABLED_KEY);
  return r[PREVIEW_ENABLED_KEY] !== false;
}

export async function setPreviewEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [PREVIEW_ENABLED_KEY]: enabled });
}

export async function isLazyPreviewEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(LAZY_PREVIEW_KEY);
  return r[LAZY_PREVIEW_KEY] !== false;
}

export async function setLazyPreviewEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [LAZY_PREVIEW_KEY]: enabled });
}

export function syncActionBadge(enabled: boolean): void {
  if (enabled) {
    void browser.action.setBadgeText({ text: '' });
    void browser.action.setTitle({
      title: 'Download Organization — classement automatique activé',
    });
  } else {
    void browser.action.setBadgeText({ text: 'off' });
    void browser.action.setBadgeBackgroundColor({ color: '#64748b' });
    void browser.action.setTitle({
      title: 'Download Organization — classement désactivé (téléchargements normaux)',
    });
  }
}
