import { browser, type Browser } from 'wxt/browser';
import { isAlreadyUnderSortFolder, shouldPreserveSuggestedFilename } from '@/lib/organizer-logic';
import {
  DOWNLOADS_CHANGED_MESSAGE,
  downloadsSnapshot,
  hasDownloadsChanged,
  isRelevantDownloadDelta,
  toWatchItem,
} from '@/lib/download-watch';
import { getArchiveFolder, isSortingEnabled, SORT_ENABLED_KEY, syncActionBadge } from '@/lib/sorting-settings';

type DownloadItem = Browser.downloads.DownloadItem;

function fileBasename(path: string): string {
  const normalized = path.replace(/\\/g, '/');
  return normalized.split('/').pop() ?? path;
}

/** Dossier relatif au répertoire « Téléchargements » (sans slash final). */
function resolveSortFolder(item: DownloadItem): string {
  const mimeType = item.mime ?? '';
  let folder = 'Autres';

  if (mimeType.startsWith('image/')) {
    folder = 'Images';
  } else if (mimeType.startsWith('video/')) {
    folder = 'Vidéos';
  } else if (mimeType.startsWith('audio/')) {
    folder = 'Audios';
  } else if (mimeType.startsWith('application/')) {
    folder = 'Documents';
  } else {
    const base = fileBasename(item.filename || '');
    const extension = base.split('.').pop()?.toLowerCase() ?? '';

    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
      folder = 'Images';
    } else if (['mp4', 'avi', 'mkv', 'webm', 'mov'].includes(extension)) {
      folder = 'Vidéos';
    } else if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(extension)) {
      folder = 'Audios';
    } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
      folder = 'Documents';
    }
  }

  return folder;
}

function guessBasenameForDownload(item: DownloadItem): string {
  const fromPath = item.filename ? fileBasename(item.filename) : '';
  if (fromPath && fromPath !== '/' && fromPath.includes('.')) return fromPath;

  const source = item.finalUrl || item.url;
  try {
    const name = fileBasename(new URL(source).pathname);
    if (name && name !== '/' && name !== source) return decodeURIComponent(name);
  } catch {
    /* ignore */
  }
  return fromPath || 'download';
}

/** Ne pas toucher aux téléchargements lancés par une extension (dont la nôtre après relance). */
function shouldIgnoreFirefoxDownload(item: DownloadItem): boolean {
  if (item.byExtensionId) return true;

  if (!item.url) return true;
  const u = item.url.toLowerCase();
  if (
    u.startsWith('blob:') ||
    u.startsWith('data:') ||
    u.startsWith('file:') ||
    u.startsWith('moz-extension:') ||
    u.startsWith('about:')
  ) {
    return true;
  }

  if (item.state === 'complete' || item.state === 'interrupted') return true;

  return false;
}

function registerFirefoxDownloadSorter(): void {
  browser.downloads.onCreated.addListener((item) => {
    void (async () => {
      if (!(await isSortingEnabled())) return;
      if (shouldIgnoreFirefoxDownload(item)) return;
      if (isAlreadyUnderSortFolder(item.filename)) return;

      const folder = resolveSortFolder(item);
      const base = guessBasenameForDownload(item);
      const relativePath = `${folder}/${base}`;

      const sourceUrl =
        typeof item.finalUrl === 'string' && item.finalUrl.length > 0 ? item.finalUrl : item.url;

      try {
        await browser.downloads.cancel(item.id);
      } catch {
        /* déjà terminé / non annulable */
      }

      try {
        await browser.downloads.download({
          url: sourceUrl,
          filename: relativePath,
          conflictAction: 'uniquify',
          saveAs: false,
        });
      } catch (err) {
        console.error('[download-organizer] Firefox: impossible de relancer le téléchargement', err);
      }
    })();
  });
}

function registerChromiumDownloadSorter(): void {
  browser.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
    void (async () => {
      try {
        if (!(await isSortingEnabled())) {
          suggest();
          return;
        }

        const archiveFolder = await getArchiveFolder();
        if (
          shouldPreserveSuggestedFilename({
            byExtensionId: downloadItem.byExtensionId,
            filename: downloadItem.filename,
            archiveFolder,
          })
        ) {
          suggest();
          return;
        }

        const mimeType = downloadItem.mime ?? '';
        let folder = 'Autres';

        if (mimeType.startsWith('image/')) {
          folder = 'Images';
        } else if (mimeType.startsWith('video/')) {
          folder = 'Vidéos';
        } else if (mimeType.startsWith('audio/')) {
          folder = 'Audios';
        } else if (mimeType.startsWith('application/')) {
          folder = 'Documents';
        } else {
          const base = downloadItem.filename.split(/[/\\]/).pop() ?? downloadItem.filename;
          const extension = base.split('.').pop()?.toLowerCase() ?? '';

          if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp'].includes(extension)) {
            folder = 'Images';
          } else if (['mp4', 'avi', 'mkv', 'webm', 'mov'].includes(extension)) {
            folder = 'Vidéos';
          } else if (['mp3', 'wav', 'aac', 'flac', 'ogg'].includes(extension)) {
            folder = 'Audios';
          } else if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(extension)) {
            folder = 'Documents';
          }
        }

        const newFilename = `${folder}/${downloadItem.filename}`;
        suggest({ filename: newFilename });
      } catch {
        suggest();
      }
    })();
    return true;
  });
}

async function refreshBadgeFromStorage(): Promise<void> {
  syncActionBadge(await isSortingEnabled());
}

const WATCH_ALARM = 'watch-downloads';
let lastWatchSnapshot = '';

async function scanDownloads(): Promise<void> {
  try {
    const items = await browser.downloads.search({
      limit: 10000,
      orderBy: ['-startTime'],
    });
    const watched = items
      .map(toWatchItem)
      .filter((item): item is NonNullable<typeof item> => item != null);
    const next = downloadsSnapshot(watched);
    if (!hasDownloadsChanged(lastWatchSnapshot, next)) return;
    lastWatchSnapshot = next;
    try {
      await browser.runtime.sendMessage({ type: DOWNLOADS_CHANGED_MESSAGE });
    } catch {
      /* panneau fermé : le prochain scan / ouverture rattrapera */
    }
  } catch (err) {
    console.error('[download-organizer] Impossible de surveiller Téléchargements', err);
  }
}

function registerDownloadWatch(): void {
  browser.downloads.onCreated.addListener(() => {
    void scanDownloads();
  });
  browser.downloads.onChanged.addListener((delta) => {
    if (!isRelevantDownloadDelta(delta)) return;
    void scanDownloads();
  });
  browser.downloads.onErased.addListener(() => {
    void scanDownloads();
  });

  void browser.alarms.create(WATCH_ALARM, { periodInMinutes: 1 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== WATCH_ALARM) return;
    void scanDownloads();
  });

  void scanDownloads();
}

export default defineBackground(() => {
  void refreshBadgeFromStorage();
  registerDownloadWatch();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[SORT_ENABLED_KEY]) return;
    const v = changes[SORT_ENABLED_KEY].newValue;
    syncActionBadge(v !== false);
  });

  if (import.meta.env.FIREFOX) {
    registerFirefoxDownloadSorter();
  } else {
    registerChromiumDownloadSorter();
  }
});
