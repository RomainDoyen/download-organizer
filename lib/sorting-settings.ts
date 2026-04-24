import { browser } from 'wxt/browser';

export const SORT_ENABLED_KEY = 'sortDownloadsEnabled' as const;

export async function isSortingEnabled(): Promise<boolean> {
  const r = await browser.storage.local.get(SORT_ENABLED_KEY);
  return r[SORT_ENABLED_KEY] !== false;
}

export async function setSortingEnabled(enabled: boolean): Promise<void> {
  await browser.storage.local.set({ [SORT_ENABLED_KEY]: enabled });
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
