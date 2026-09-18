import './style.css';
import { browser, type Browser } from 'wxt/browser';
import {
  archiveRelativePath,
  canArchiveFromUrl,
  canPreviewFromUrl,
  escapeHtml,
  indicesInRange,
  isSafeMediaContentType,
  isUnderFolder,
  keyToAction,
  shouldCancelBeforeArchive,
} from '@/lib/organizer-logic';
import {
  DOWNLOADS_CHANGED_MESSAGE,
  downloadsSnapshot,
  isRelevantDownloadDelta,
} from '@/lib/download-watch';
import {
  archiveLocalFile,
  canMutateLocalFile,
  chromiumFolderFlagHint,
  folderNameFromFiles,
  folderRecordKey,
  getLocalFileBlob,
  isDirectoryInputSupported,
  isFolderAccessSupported,
  listLocalDownloadFiles,
  localRecordsFromFiles,
  mergeUncoveredFsItems,
  needsChromiumFolderFlag,
  pickDownloadsFolder,
  pickDownloadsFolderViaInput,
  queryFolderPermission,
  removeLocalFile,
  requestFolderPermission,
  uniqueDisplayName,
  fsStableId,
  type LocalFileRecord,
} from '@/lib/local-folder';
import {
  DOWNLOADS_FOLDER_LINKED_KEY,
  addDirHandle,
  addSessionFolderGroup,
  loadDirHandles,
  loadSessionFolderGroups,
  removeDirHandleAt,
  removeSessionFolderGroupAt,
  type SessionFolderGroup,
} from '@/lib/folder-handle-store';
import {
  getArchiveFolder,
  setArchiveFolder,
  isPreviewEnabled,
  setPreviewEnabled,
  isLazyPreviewEnabled,
  setLazyPreviewEnabled,
} from '@/lib/sorting-settings';

type DownloadItem = Browser.downloads.DownloadItem;
type FileCategory = 'image' | 'video' | 'audio' | 'document' | 'archive' | 'other';

interface FileEntry {
  id: number;
  filename: string;
  basename: string;
  url: string;
  mime: string;
  fileSize: number;
  startTime: string;
  endTime?: string;
  state: string;
  category: FileCategory;
  exists: boolean;
  source: 'chrome' | 'fs';
  relativePath?: string;
}

const CATEGORY_LABELS: Record<FileCategory, string> = {
  image: 'Images',
  video: 'Vidéos',
  audio: 'Audios',
  document: 'Documents',
  archive: 'Archives',
  other: 'Autres',
};

const CATEGORY_ICONS: Record<FileCategory, string> = {
  image: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 17"/></svg>`,
  video: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>`,
  audio: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>`,
  document: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`,
  archive: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/></svg>`,
  other: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg>`,
};

const ACTION_ICONS = {
  delete: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  archive: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="21 8 21 21 3 21 3 8"/><rect x="1" y="3" width="22" height="5" rx="1"/></svg>`,
  open: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`,
};

let allFiles: FileEntry[] = [];
let filteredFiles: FileEntry[] = [];
let selectedIndex = -1;
let selectedId: number | null = null;
let isLoading = false;
let archiveFolder = 'Archives';
let previewEnabled = true;
let lazyPreviewEnabled = true;
let searchQuery = '';
let currentSort = 'date-desc';
let currentFilter = 'all';
const hiddenIds = new Set<number>();
const ignoreCompleteIds = new Set<number>();
const checkedIds = new Set<number>();
const previewObjectUrls: string[] = [];
let lastCheckedIndex = -1;
let previewObserver: IntersectionObserver | null = null;
let pendingReload = false;
let lastListSnapshot: string | null = null;
let reloadTimer: ReturnType<typeof setTimeout> | undefined;
let listenersBound = false;
let dirHandles: FileSystemDirectoryHandle[] = [];
let folderPermission: PermissionState | 'unsupported' = 'prompt';
const fsById = new Map<number, LocalFileRecord>();
let sessionGroups: SessionFolderGroup[] = [];

const mainEl = document.getElementById('main')!;
const fileListEl = document.getElementById('file-list')!;
const fileCountEl = document.getElementById('file-count')!;
const emptyStateEl = document.getElementById('empty-state')!;
const loadingStateEl = document.getElementById('loading-state')!;
const footerEl = document.getElementById('footer')!;
const footerStatusEl = document.getElementById('footer-status')!;
const selectionBar = document.getElementById('selection-bar')!;
const selectAllInput = document.getElementById('select-all') as HTMLInputElement;
const selectionCountEl = document.getElementById('selection-count')!;
const bulkDeleteBtn = document.getElementById('bulk-delete') as HTMLButtonElement;
const bulkArchiveBtn = document.getElementById('bulk-archive') as HTMLButtonElement;
const sortSelect = document.getElementById('sort-select') as HTMLSelectElement;
const filterSelect = document.getElementById('filter-select') as HTMLSelectElement;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const refreshBtn = document.getElementById('refresh-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const archiveFolderInput = document.getElementById('archive-folder-input') as HTMLInputElement;
const archivePreviewEl = document.getElementById('archive-preview')!;
const previewEnabledInput = document.getElementById('preview-enabled') as HTMLInputElement;
const lazyPreviewInput = document.getElementById('preview-lazy') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings')!;
const folderBanner = document.getElementById('folder-banner')!;
const folderBannerText = document.getElementById('folder-banner-text')!;
const folderBannerHint = document.getElementById('folder-banner-hint')!;
const grantFolderBtn = document.getElementById('grant-folder-btn') as HTMLButtonElement;
const folderAccessStatus = document.getElementById('folder-access-status')!;
const folderAccessBtn = document.getElementById('folder-access-btn') as HTMLButtonElement;
const folderListEl = document.getElementById('folder-list')!;
const confirmDialog = document.getElementById('confirm-dialog') as HTMLDialogElement;
const confirmTitle = document.getElementById('confirm-title')!;
const confirmText = document.getElementById('confirm-text')!;
const confirmAccept = document.getElementById('confirm-accept') as HTMLButtonElement;
let confirmIgnoreUntil = 0;

function askConfirm(options: { title: string; text: string; confirmLabel?: string }): Promise<boolean> {
  confirmTitle.textContent = options.title;
  confirmText.textContent = options.text;
  confirmAccept.textContent = options.confirmLabel ?? 'Supprimer';

  return new Promise((resolve) => {
    const finish = () => {
      confirmDialog.removeEventListener('close', finish);
      resolve(confirmDialog.returnValue === 'confirm');
    };

    window.setTimeout(() => {
      if (confirmDialog.open) confirmDialog.close('cancel');
      confirmDialog.returnValue = '';
      confirmIgnoreUntil = Date.now() + 350;
      confirmDialog.addEventListener('close', finish);
      confirmDialog.showModal();
    }, 0);
  });
}

function confirmDeleteFiles(files: FileEntry[]): Promise<boolean> {
  if (files.length === 0) return Promise.resolve(false);
  if (files.length === 1) {
    return askConfirm({
      title: 'Supprimer ce fichier ?',
      text: `« ${files[0]!.basename} » sera retiré du disque. Cette action est définitive.`,
    });
  }
  return askConfirm({
    title: `Supprimer ${files.length} fichiers ?`,
    text: 'Ils seront retirés du disque. Cette action est définitive.',
  });
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} Go`;
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
  if (days === 1) {
    return `Hier ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
  }
  if (days < 7) {
    return date.toLocaleDateString('fr-FR', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function detectCategory(mime: string, filename: string): FileCategory {
  const mimeType = mime?.toLowerCase() || '';
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('application/')) {
    if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp'].includes(ext)) {
      return 'document';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) {
      return 'archive';
    }
    return 'document';
  }
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'svg', 'webp', 'ico', 'tiff', 'avif'].includes(ext)) return 'image';
  if (['mp4', 'avi', 'mkv', 'webm', 'mov', 'flv', 'wmv', 'm4v', '3gp'].includes(ext)) return 'video';
  if (['mp3', 'wav', 'aac', 'flac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext)) return 'audio';
  if (['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp'].includes(ext)) return 'document';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'].includes(ext)) return 'archive';
  return 'other';
}

function createFileEntry(item: DownloadItem): FileEntry {
  const category = detectCategory(item.mime || '', item.filename || '');
  return {
    id: item.id!,
    filename: item.filename || '',
    basename: item.filename?.split(/[/\\]/).pop() || `download-${item.id}`,
    url: item.finalUrl || item.url || '',
    mime: item.mime || '',
    fileSize: item.fileSize || item.totalBytes || 0,
    startTime: item.startTime || new Date().toISOString(),
    endTime: item.endTime,
    state: item.state || 'complete',
    category,
    exists: item.exists !== false,
    source: 'chrome',
  };
}

function createFsFileEntry(record: LocalFileRecord): FileEntry {
  const folderName = record.folderName || 'Dossier';
  return {
    id: fsStableId(folderRecordKey(folderName, record.relativePath)),
    filename: `${folderName}/${record.relativePath}`,
    basename: record.name,
    url: '',
    mime: record.mime,
    fileSize: record.size,
    startTime: new Date(record.lastModified).toISOString(),
    state: 'complete',
    category: detectCategory(record.mime, record.name),
    exists: true,
    source: 'fs',
    relativePath: record.relativePath,
  };
}

function connectedFolderCount(): number {
  return dirHandles.length + sessionGroups.length;
}

function connectedFolderNames(): string[] {
  return [...dirHandles.map((handle) => handle.name), ...sessionGroups.map((group) => group.name)];
}

function labeledHandles(): { handle: FileSystemDirectoryHandle; label: string }[] {
  const used: string[] = [];
  return dirHandles.map((handle) => {
    const label = uniqueDisplayName(handle.name, used);
    used.push(label);
    return { handle, label };
  });
}

function renderConnectedFolders(): void {
  const items: { kind: 'handle' | 'session'; index: number; name: string; extra: string }[] = [
    ...labeledHandles().map(({ handle, label }, index) => ({
      kind: 'handle' as const,
      index,
      name: label,
      extra: handle.name === label ? 'accès persistant' : `${handle.name} · accès persistant`,
    })),
    ...sessionGroups.map((group, index) => ({
      kind: 'session' as const,
      index,
      name: group.name,
      extra: `${group.files.length} fichier${group.files.length > 1 ? 's' : ''} · jusqu’à la fermeture du navigateur`,
    })),
  ];

  if (items.length === 0) {
    folderListEl.hidden = true;
    folderListEl.innerHTML = '';
    return;
  }

  folderListEl.hidden = false;
  folderListEl.innerHTML = items
    .map(
      (item) => `
        <li class="folder-list__item">
          <span class="folder-list__meta">
            <span class="folder-list__name">${escapeHtml(item.name)}</span>
            <span class="folder-list__extra">${escapeHtml(item.extra)}</span>
          </span>
          <button type="button" class="btn btn--secondary folder-list__remove" data-kind="${item.kind}" data-index="${item.index}">
            Retirer
          </button>
        </li>`,
    )
    .join('');
}

function updateFolderAccessUi(): void {
  folderAccessBtn.hidden = false;
  folderAccessBtn.textContent = 'Ajouter un dossier';
  const count = connectedFolderCount();
  const hasPersistent = dirHandles.length > 0;
  const hasSession = sessionGroups.length > 0;
  const ready = (folderPermission === 'granted' && hasPersistent) || hasSession;
  renderConnectedFolders();

  if (needsChromiumFolderFlag()) {
    folderBannerHint.hidden = false;
    folderBannerHint.textContent = chromiumFolderFlagHint();
  } else {
    folderBannerHint.hidden = true;
  }

  if (ready) {
    folderBanner.hidden = true;
    const names = connectedFolderNames().join(', ');
    folderAccessStatus.textContent =
      count === 1
        ? `Dossier connecté : ${names}. Ajoutez-en d’autres si besoin.`
        : `${count} dossiers connectés : ${names}.`;
    return;
  }

  folderBanner.hidden = false;
  grantFolderBtn.textContent = hasPersistent ? 'Rétablir l’accès' : 'Ajouter un dossier';

  if (hasPersistent && folderPermission !== 'granted') {
    folderBannerText.textContent =
      'L’accès à un ou plusieurs dossiers a été révoqué. Réactivez-le pour revoir les fichiers copiés à la main.';
    folderAccessStatus.textContent = 'Accès en attente. Un clic suffit pour le rétablir, puis vous pourrez en ajouter d’autres.';
    return;
  }

  folderBannerText.textContent =
    'Ajoutez Téléchargements, le Bureau ou n’importe quel autre dossier. Vous pouvez en connecter plusieurs : racine et sous-dossiers de chacun sont listés.';
  folderAccessStatus.textContent =
    'Aucun dossier connecté. Sans connexion, seuls les téléchargements du navigateur sont listés.';
}

async function openFolderAccessTab(): Promise<void> {
  const url = browser.runtime.getURL('/folder-access.html');
  await browser.tabs.create({ url, active: true });
}

async function refreshFolderPermission(): Promise<void> {
  if (!isFolderAccessSupported()) {
    folderPermission = dirHandles.length > 0 ? 'prompt' : 'unsupported';
    updateFolderAccessUi();
    return;
  }

  if (dirHandles.length === 0) {
    folderPermission = 'prompt';
    updateFolderAccessUi();
    return;
  }

  let granted = 0;
  for (const handle of dirHandles) {
    try {
      if ((await queryFolderPermission(handle)) === 'granted') granted += 1;
    } catch {
      /* handle invalide */
    }
  }
  folderPermission = granted > 0 ? 'granted' : 'prompt';
  updateFolderAccessUi();
}

async function restoreExistingHandles(): Promise<boolean> {
  if (!isFolderAccessSupported() || dirHandles.length === 0) return false;
  let granted = false;
  for (const handle of dirHandles) {
    try {
      let state = await queryFolderPermission(handle);
      if (state !== 'granted') {
        state = await requestFolderPermission(handle);
      }
      if (state === 'granted') granted = true;
    } catch {
      /* ignore */
    }
  }
  await refreshFolderPermission();
  return granted;
}

async function connectViaDirectoryInput(): Promise<boolean> {
  if (!isDirectoryInputSupported()) return false;
  const files = await pickDownloadsFolderViaInput();
  if (files.length === 0) return false;
  const name = uniqueDisplayName(folderNameFromFiles(files), connectedFolderNames());
  try {
    sessionGroups = await addSessionFolderGroup({ name, files });
  } catch {
    sessionGroups = [...sessionGroups, { name, files }];
  }
  await browser.storage.local.set({ [DOWNLOADS_FOLDER_LINKED_KEY]: Date.now() });
  updateFolderAccessUi();
  lastListSnapshot = null;
  void loadDownloads();
  return true;
}

async function connectDownloadsFolder(intent: 'add' | 'restore' = 'add'): Promise<void> {
  try {
    if (isFolderAccessSupported()) {
      const restored = await restoreExistingHandles();
      if (intent === 'restore' && restored) {
        lastListSnapshot = null;
        void loadDownloads();
        return;
      }

      try {
        const handle = await pickDownloadsFolder();
        let permission = await queryFolderPermission(handle);
        if (permission !== 'granted') {
          permission = await requestFolderPermission(handle);
        }
        if (permission === 'granted') {
          const before = dirHandles.length;
          dirHandles = await addDirHandle(handle);
          folderPermission = 'granted';
          await browser.storage.local.set({ [DOWNLOADS_FOLDER_LINKED_KEY]: Date.now() });
          if (dirHandles.length === before) {
            footerStatusEl.textContent = `« ${handle.name} » est déjà connecté.`;
            clearStatusAfter(3000);
          }
        }
        updateFolderAccessUi();
        lastListSnapshot = null;
        void loadDownloads();
        return;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        console.warn('[organizer] Sélecteur avancé indisponible, repli fichier', err);
      }
    }

    if (await connectViaDirectoryInput()) return;
    await openFolderAccessTab();
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    console.error('[organizer] Accès dossier impossible', err);
    try {
      await openFolderAccessTab();
    } catch {
      footerStatusEl.textContent = 'Impossible d’accéder au dossier';
      clearStatusAfter(4000);
    }
  }
}

async function removeConnectedFolder(kind: 'handle' | 'session', index: number): Promise<void> {
  const name = kind === 'handle' ? labeledHandles()[index]?.label : sessionGroups[index]?.name;
  if (!name) return;
  const ok = await askConfirm({
    title: 'Retirer ce dossier ?',
    text: `« ${name} » ne sera plus listé. Les fichiers sur le disque ne seront pas effacés.`,
    confirmLabel: 'Retirer',
  });
  if (!ok) return;
  if (kind === 'handle') {
    dirHandles = await removeDirHandleAt(index);
  } else {
    sessionGroups = await removeSessionFolderGroupAt(index);
  }
  await browser.storage.local.set({ [DOWNLOADS_FOLDER_LINKED_KEY]: Date.now() });
  await refreshFolderPermission();
  lastListSnapshot = null;
  void loadDownloads();
}

function applyLocalRecords(chromeFilenames: string[], records: LocalFileRecord[]): FileEntry[] {
  const extra = mergeUncoveredFsItems(chromeFilenames, records);
  return extra.map((record) => {
    const entry = createFsFileEntry(record);
    fsById.set(entry.id, record);
    return entry;
  });
}

async function loadLocalFolderFiles(chromeFilenames: string[]): Promise<FileEntry[]> {
  fsById.clear();
  const records: LocalFileRecord[] = [];

  if (dirHandles.length > 0 && isFolderAccessSupported()) {
    for (const { handle, label } of labeledHandles()) {
      try {
        if ((await queryFolderPermission(handle)) !== 'granted') continue;
        const listed = await listLocalDownloadFiles(handle, archiveFolder);
        for (const record of listed) {
          records.push({ ...record, folderName: label, root: handle });
        }
      } catch (err) {
        console.error('[organizer] Lecture d’un dossier connecté impossible', err);
      }
    }
  }

  if (sessionGroups.length === 0) {
    try {
      sessionGroups = await loadSessionFolderGroups();
    } catch {
      sessionGroups = [];
    }
  }

  for (const group of sessionGroups) {
    records.push(...localRecordsFromFiles(group.files, archiveFolder, group.name));
  }

  updateFolderAccessUi();
  if (records.length === 0) return [];
  return applyLocalRecords(chromeFilenames, records);
}

function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    reloadTimer = undefined;
    void loadDownloads();
  }, 250);
}

async function loadDownloads(): Promise<void> {
  if (isLoading) {
    pendingReload = true;
    return;
  }
  isLoading = true;
  showLoading(true);
  let shouldRender = false;

  try {
    const downloads = await browser.downloads.search({
      limit: 10000,
      orderBy: ['-startTime'],
    });

    const chromeFiles = downloads
      .filter((d) => d.state === 'complete' && d.filename)
      .filter((d) => d.exists !== false)
      .filter((d) => !hiddenIds.has(d.id!))
      .filter((d) => !isUnderFolder(d.filename || '', archiveFolder))
      .map(createFileEntry);

    const localFiles = await loadLocalFolderFiles(chromeFiles.map((file) => file.filename));
    const nextFiles = [...chromeFiles, ...localFiles].filter((file) => !hiddenIds.has(file.id));

    const snap = downloadsSnapshot(
      nextFiles.map((file) => ({
        id: file.id,
        filename: file.filename,
        state: file.state,
        exists: file.exists,
        fileSize: file.fileSize,
      })),
    );
    const listChanged = lastListSnapshot === null || snap !== lastListSnapshot;
    lastListSnapshot = snap;

    if (listChanged) {
      allFiles = nextFiles;
      applyFilterAndSort();
      restoreSelection();
      shouldRender = true;
    }
  } catch (err) {
    console.error('[organizer] Failed to load downloads:', err);
    footerStatusEl.textContent = 'Erreur lors du chargement';
    shouldRender = true;
  } finally {
    isLoading = false;
    showLoading(false);
    if (shouldRender) updateUI();
    if (pendingReload) {
      pendingReload = false;
      void loadDownloads();
    }
  }
}

function showLoading(show: boolean): void {
  if (show && allFiles.length > 0) {
    loadingStateEl.hidden = true;
    return;
  }
  loadingStateEl.hidden = !show;
  if (show) {
    emptyStateEl.hidden = true;
    fileListEl.hidden = true;
  }
}

function applyFilterAndSort(): void {
  let result = allFiles.filter((f) => !hiddenIds.has(f.id));

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    result = result.filter(
      (f) => f.basename.toLowerCase().includes(q) || f.filename.toLowerCase().includes(q),
    );
  }

  if (currentFilter !== 'all') {
    result = result.filter((f) => f.category === currentFilter);
  }

  result.sort((a, b) => {
    switch (currentSort) {
      case 'date-desc':
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      case 'date-asc':
        return new Date(a.startTime).getTime() - new Date(b.startTime).getTime();
      case 'name-asc':
        return a.basename.localeCompare(b.basename, 'fr', { numeric: true });
      case 'name-desc':
        return b.basename.localeCompare(a.basename, 'fr', { numeric: true });
      case 'size-desc':
        return b.fileSize - a.fileSize;
      case 'size-asc':
        return a.fileSize - b.fileSize;
      case 'type':
        return a.category.localeCompare(b.category) || a.basename.localeCompare(b.basename, 'fr', { numeric: true });
      default:
        return 0;
    }
  });

  filteredFiles = result;
}

function restoreSelection(): void {
  if (selectedId != null) {
    const idx = filteredFiles.findIndex((f) => f.id === selectedId);
    if (idx >= 0) {
      selectedIndex = idx;
      return;
    }
  }
  if (filteredFiles.length === 0) {
    selectedIndex = -1;
    selectedId = null;
    return;
  }
  if (selectedIndex >= filteredFiles.length) {
    selectedIndex = filteredFiles.length - 1;
  }
  if (selectedIndex < 0) selectedIndex = 0;
  selectedId = filteredFiles[selectedIndex]?.id ?? null;
}

function updateUI(): void {
  fileCountEl.textContent = `${filteredFiles.length} fichier${filteredFiles.length > 1 ? 's' : ''}`;
  footerEl.hidden = filteredFiles.length === 0;
  selectionBar.hidden = filteredFiles.length === 0;
  emptyStateEl.hidden = filteredFiles.length > 0 || isLoading;
  fileListEl.hidden = filteredFiles.length === 0;
  pruneCheckedIds();
  renderFileList();
  updateSelectionBar();
}

function revokePreviewUrls(): void {
  for (const url of previewObjectUrls) URL.revokeObjectURL(url);
  previewObjectUrls.length = 0;
}

function renderFileList(): void {
  revokePreviewUrls();
  fileListEl.innerHTML = filteredFiles.map((file, index) => renderFileItem(file, index)).join('');

  if (selectedIndex >= 0 && selectedIndex < filteredFiles.length) {
    const selectedEl = fileListEl.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
    selectedEl?.classList.add('file-item--selected');
    selectedEl?.scrollIntoView({ block: 'nearest' });
    selectedEl?.focus();
  }

  setupPreviewObserver();
}

function renderFileItem(file: FileEntry, index: number): string {
  const icon = CATEGORY_ICONS[file.category];
  const badgeClass = `file-type-badge--${file.category}`;
  const previewClass = `file-preview--${file.category}`;
  const remotePreview =
    previewEnabled &&
    (file.category === 'image' || file.category === 'video') &&
    canPreviewFromUrl(file.url, file.mime);

  const previewAttrs = previewEnabled
    ? `data-preview="1" data-preview-kind="${file.category}"${remotePreview ? ` data-preview-url="${escapeHtml(file.url)}"` : ''} data-id="${file.id}"`
    : '';

  const checked = checkedIds.has(file.id);

  return `
    <article class="file-item${checked ? ' file-item--checked' : ''}" data-index="${index}" data-id="${file.id}" role="listitem" tabindex="0">
      <label class="file-check-wrap">
        <input type="checkbox" class="file-check" ${checked ? 'checked' : ''} aria-label="Sélectionner ${escapeHtml(file.basename)}" />
      </label>
      <div class="file-preview ${previewClass}" aria-hidden="true" ${previewAttrs}>
        <span class="file-preview__icon">${icon}</span>
      </div>
      <div class="file-info">
        <span class="file-name" title="${escapeHtml(file.basename)}">${escapeHtml(file.basename)}</span>
        <div class="file-meta">
          <span class="file-size">${formatFileSize(file.fileSize)}</span>
          <span class="file-date">${formatDate(file.startTime)}</span>
          <span class="file-type-badge ${badgeClass}">${CATEGORY_LABELS[file.category]}</span>
        </div>
      </div>
      <div class="file-actions">
        <button type="button" class="action-btn action-btn--delete" data-action="delete" aria-label="Supprimer ${escapeHtml(file.basename)}" title="Supprimer (←)">
          ${ACTION_ICONS.delete}
        </button>
        <button type="button" class="action-btn action-btn--archive" data-action="archive" aria-label="Archiver ${escapeHtml(file.basename)}" title="Archiver (→)">
          ${ACTION_ICONS.archive}
        </button>
        <button type="button" class="action-btn action-btn--open" data-action="open" aria-label="Ouvrir ${escapeHtml(file.basename)}" title="Ouvrir (↑)">
          ${ACTION_ICONS.open}
        </button>
      </div>
    </article>
  `;
}

function setupPreviewObserver(): void {
  previewObserver?.disconnect();
  if (!previewEnabled) return;

  const nodes = fileListEl.querySelectorAll<HTMLElement>('[data-preview]');
  if (!lazyPreviewEnabled) {
    nodes.forEach((el) => {
      void hydratePreview(el);
    });
    return;
  }

  previewObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const el = entry.target as HTMLElement;
        previewObserver?.unobserve(el);
        void hydratePreview(el);
      }
    },
    { root: mainEl, rootMargin: '120px' },
  );

  nodes.forEach((el) => previewObserver!.observe(el));
}

async function fetchImagePreviewUrl(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      referrerPolicy: 'no-referrer',
      credentials: 'omit',
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!isSafeMediaContentType(type, 'image')) return null;
    const blob = await res.blob();
    if (!isSafeMediaContentType(blob.type || type, 'image')) return null;
    const objectUrl = URL.createObjectURL(blob);
    previewObjectUrls.push(objectUrl);
    return objectUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function hydratePreview(el: HTMLElement): Promise<void> {
  if (!el.isConnected) return;
  const url = el.getAttribute('data-preview-url');
  const kind = el.getAttribute('data-preview-kind');
  const id = Number(el.closest('.file-item')?.getAttribute('data-id'));
  const record = Number.isFinite(id) ? fsById.get(id) : undefined;

  if (record && (kind === 'image' || kind === 'video')) {
    try {
      const blob = await getLocalFileBlob(record);
      if (!el.isConnected) return;
      const objectUrl = URL.createObjectURL(blob);
      previewObjectUrls.push(objectUrl);
      if (kind === 'image') {
        const img = document.createElement('img');
        img.className = 'file-preview__img';
        img.alt = '';
        img.src = objectUrl;
        el.replaceChildren(img);
      } else {
        const video = document.createElement('video');
        video.className = 'file-preview__img';
        video.muted = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.src = objectUrl;
        el.replaceChildren(video);
      }
      return;
    } catch {
      /* icône par défaut */
    }
  }

  if (url && kind === 'image') {
    const objectUrl = await fetchImagePreviewUrl(url);
    if (!el.isConnected) return;
    if (!objectUrl) {
      await fallbackFileIcon(el, id);
      return;
    }
    const img = document.createElement('img');
    img.className = 'file-preview__img';
    img.alt = '';
    img.addEventListener(
      'error',
      () => {
        void fallbackFileIcon(el, id);
      },
      { once: true },
    );
    img.src = objectUrl;
    el.replaceChildren(img);
    return;
  }

  if (url && kind === 'video') {
    const video = document.createElement('video');
    video.className = 'file-preview__img';
    video.muted = true;
    video.preload = 'metadata';
    video.playsInline = true;
    video.referrerPolicy = 'no-referrer';
    video.addEventListener(
      'error',
      () => {
        void fallbackFileIcon(el, id);
      },
      { once: true },
    );
    video.src = url;
    el.replaceChildren(video);
    return;
  }

  await fallbackFileIcon(el, id);
}

async function fallbackFileIcon(el: HTMLElement, id: number): Promise<void> {
  if (!id || !el.isConnected) return;
  try {
    const iconUrl = await browser.downloads.getFileIcon(id, { size: 32 });
    if (!iconUrl || !el.isConnected) return;
    const img = document.createElement('img');
    img.className = 'file-preview__img';
    img.alt = '';
    img.src = iconUrl;
    el.replaceChildren(img);
  } catch {
    /* conserve l'icône SVG */
  }
}

function pruneCheckedIds(): void {
  const visible = new Set(filteredFiles.map((f) => f.id));
  for (const id of [...checkedIds]) {
    if (!visible.has(id)) checkedIds.delete(id);
  }
}

function updateSelectionBar(): void {
  const count = filteredFiles.reduce((n, f) => n + (checkedIds.has(f.id) ? 1 : 0), 0);
  const total = filteredFiles.length;
  selectionCountEl.textContent =
    count === 0
      ? 'Aucune sélection'
      : `${count} sélectionné${count > 1 ? 's' : ''}`;
  selectAllInput.checked = total > 0 && count === total;
  selectAllInput.indeterminate = count > 0 && count < total;
  bulkDeleteBtn.disabled = count === 0;
  bulkArchiveBtn.disabled = count === 0;
}

function syncCheckboxes(): void {
  fileListEl.querySelectorAll<HTMLElement>('.file-item').forEach((el) => {
    const id = Number(el.getAttribute('data-id'));
    const checked = checkedIds.has(id);
    const cb = el.querySelector<HTMLInputElement>('.file-check');
    if (cb) cb.checked = checked;
    el.classList.toggle('file-item--checked', checked);
  });
  updateSelectionBar();
}

function toggleChecked(index: number, shiftKey: boolean): void {
  const file = filteredFiles[index];
  if (!file) return;

  if (shiftKey && lastCheckedIndex >= 0) {
    const makeChecked = !checkedIds.has(file.id);
    for (const i of indicesInRange(lastCheckedIndex, index)) {
      const f = filteredFiles[i];
      if (!f) continue;
      if (makeChecked) checkedIds.add(f.id);
      else checkedIds.delete(f.id);
    }
  } else if (checkedIds.has(file.id)) {
    checkedIds.delete(file.id);
  } else {
    checkedIds.add(file.id);
  }

  lastCheckedIndex = index;
  syncCheckboxes();
}

function selectAllVisible(checked: boolean): void {
  if (checked) {
    for (const f of filteredFiles) checkedIds.add(f.id);
  } else {
    for (const f of filteredFiles) checkedIds.delete(f.id);
  }
  lastCheckedIndex = checked && filteredFiles.length > 0 ? 0 : -1;
  syncCheckboxes();
}

function getCheckedTargets(): FileEntry[] {
  const selected = filteredFiles.filter((f) => checkedIds.has(f.id));
  if (selected.length > 0) return selected;
  if (selectedIndex >= 0 && filteredFiles[selectedIndex]) return [filteredFiles[selectedIndex]!];
  return [];
}

async function requestDeleteFiles(files: FileEntry[]): Promise<void> {
  if (files.length === 0) return;
  if (!(await confirmDeleteFiles(files))) return;
  for (const file of files) {
    const index = filteredFiles.findIndex((f) => f.id === file.id);
    if (index >= 0) await deleteFile(index);
  }
}

async function deleteChecked(): Promise<void> {
  await requestDeleteFiles(getCheckedTargets());
}

async function archiveChecked(): Promise<void> {
  const targets = getCheckedTargets();
  for (const file of targets) {
    const index = filteredFiles.findIndex((f) => f.id === file.id);
    if (index >= 0) await archiveFile(index);
  }
}

function selectItem(index: number): void {
  if (index < 0 || index >= filteredFiles.length) return;

  const prevEl = fileListEl.querySelector('.file-item--selected');
  prevEl?.classList.remove('file-item--selected');

  selectedIndex = index;
  selectedId = filteredFiles[index]?.id ?? null;
  const newEl = fileListEl.querySelector(`[data-index="${index}"]`) as HTMLElement | null;
  newEl?.classList.add('file-item--selected');
  newEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  newEl?.focus();
}

function handleAction(action: string, index: number): void {
  switch (action) {
    case 'delete': {
      const file = filteredFiles[index];
      if (file) void requestDeleteFiles([file]);
      break;
    }
    case 'archive':
      void archiveFile(index);
      break;
    case 'open':
      void openFile(index);
      break;
  }
}

function dismissFromQueue(file: FileEntry): void {
  hiddenIds.add(file.id);
  checkedIds.delete(file.id);
  allFiles = allFiles.filter((f) => f.id !== file.id);
  applyFilterAndSort();
  if (selectedIndex >= filteredFiles.length) {
    selectedIndex = filteredFiles.length - 1;
  }
  selectedId = filteredFiles[selectedIndex]?.id ?? null;
  updateUI();
}

function restoreDismissed(file: FileEntry): void {
  hiddenIds.delete(file.id);
  if (!allFiles.some((f) => f.id === file.id)) {
    allFiles.push(file);
  }
  applyFilterAndSort();
  restoreSelection();
  updateUI();
}

async function deleteFile(index: number): Promise<void> {
  const file = filteredFiles[index];
  if (!file || hiddenIds.has(file.id)) return;

  dismissFromQueue(file);

  try {
    if (file.source === 'fs') {
      const record = fsById.get(file.id);
      if (!record) throw new Error('missing-fs');
      if (!canMutateLocalFile(record)) {
        throw new Error('read-only-folder-access');
      }
      await removeLocalFile(record);
    } else {
      try {
        await browser.downloads.removeFile(file.id);
      } catch {
        /* déjà absent du disque */
      }
      await browser.downloads.erase({ id: file.id });
    }
    footerStatusEl.textContent = `Supprimé : ${file.basename}`;
    clearStatusAfter(2000);
    lastListSnapshot = null;
    scheduleReload();
  } catch (err) {
    console.error('[organizer] Delete failed:', err);
    restoreDismissed(file);
    footerStatusEl.textContent =
      err instanceof Error && err.message === 'read-only-folder-access'
        ? `Suppression impossible ici. ${chromiumFolderFlagHint()}`
        : `Erreur : ${file.basename}`;
    clearStatusAfter(5000);
  }
}

async function waitForDownloadComplete(id: number, timeoutMs = 120000): Promise<void> {
  const existing = await browser.downloads.search({ id });
  const current = existing[0];
  if (current?.state === 'complete') return;
  if (current?.state === 'interrupted') {
    throw new Error('interrupted');
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      browser.downloads.onChanged.removeListener(onChange);
      reject(new Error('timeout'));
    }, timeoutMs);

    function onChange(delta: { id: number; state?: { current?: string }; error?: { current?: string } }) {
      if (delta.id !== id) return;
      if (delta.state?.current === 'complete') {
        cleanup();
        resolve();
      } else if (delta.state?.current === 'interrupted') {
        cleanup();
        reject(new Error(delta.error?.current || 'interrupted'));
      }
    }

    function cleanup() {
      clearTimeout(timer);
      browser.downloads.onChanged.removeListener(onChange);
    }

    browser.downloads.onChanged.addListener(onChange);
  });
}

async function archiveFile(index: number): Promise<void> {
  const file = filteredFiles[index];
  if (!file || hiddenIds.has(file.id)) return;

  if (file.source === 'fs') {
    const record = fsById.get(file.id);
    if (!record || !record.root || !canMutateLocalFile(record)) {
      footerStatusEl.textContent = `Archivage impossible ici. ${chromiumFolderFlagHint()}`;
      clearStatusAfter(5000);
      return;
    }
    dismissFromQueue(file);
    try {
      await archiveLocalFile(record.root, record, archiveFolder);
      footerStatusEl.textContent = `Archivé : ${file.basename} → ${archiveFolder}/`;
      clearStatusAfter(2000);
      lastListSnapshot = null;
      scheduleReload();
    } catch (err) {
      console.error('[organizer] Archive FS failed:', err);
      restoreDismissed(file);
      footerStatusEl.textContent = `Erreur archivage : ${file.basename}`;
      clearStatusAfter(3000);
    }
    return;
  }

  if (!canArchiveFromUrl(file.url)) {
    footerStatusEl.textContent = `Impossible d’archiver : URL source indisponible (${file.basename})`;
    clearStatusAfter(4000);
    return;
  }

  dismissFromQueue(file);

  try {
    if (shouldCancelBeforeArchive(file.state)) {
      try {
        await browser.downloads.cancel(file.id);
      } catch {
        /* déjà terminé */
      }
    }

    const newId = await browser.downloads.download({
      url: file.url,
      filename: archiveRelativePath(archiveFolder, file.basename),
      conflictAction: 'uniquify',
      saveAs: false,
    });

    ignoreCompleteIds.add(newId);
    footerStatusEl.textContent = `Archivage… ${file.basename}`;
    void finalizeArchive(file, newId);
  } catch (err) {
    console.error('[organizer] Archive start failed:', err);
    restoreDismissed(file);
    footerStatusEl.textContent = `Erreur archivage : ${file.basename}`;
    clearStatusAfter(3000);
  }
}

async function finalizeArchive(file: FileEntry, newId: number): Promise<void> {
  try {
    await waitForDownloadComplete(newId);
    try {
      await browser.downloads.removeFile(file.id);
    } catch {
      /* original déjà déplacé / absent */
    }
    try {
      await browser.downloads.erase({ id: file.id });
    } catch {
      /* ignore */
    }
    footerStatusEl.textContent = `Archivé : ${file.basename} → ${archiveFolder}/`;
    clearStatusAfter(2000);
  } catch (err) {
    console.error('[organizer] Archive finalize failed:', err);
    restoreDismissed(file);
    footerStatusEl.textContent = `Erreur archivage : ${file.basename}`;
    clearStatusAfter(3000);
  } finally {
    ignoreCompleteIds.delete(newId);
  }
}

async function openFile(index: number): Promise<void> {
  const file = filteredFiles[index];
  if (!file) return;

  if (file.source === 'fs') {
    const record = fsById.get(file.id);
    if (!record) {
      footerStatusEl.textContent = `Impossible d’ouvrir : ${file.basename}`;
      clearStatusAfter(3000);
      return;
    }
    try {
      const blob = await getLocalFileBlob(record);
      const objectUrl = URL.createObjectURL(blob);
      previewObjectUrls.push(objectUrl);
      await browser.tabs.create({ url: objectUrl, active: true });
      footerStatusEl.textContent = `Ouvert : ${file.basename}`;
      clearStatusAfter(1500);
    } catch (err) {
      console.error('[organizer] Open FS failed:', err);
      footerStatusEl.textContent = `Impossible d’ouvrir : ${file.basename}`;
      clearStatusAfter(3000);
    }
    return;
  }

  try {
    await browser.downloads.open(file.id);
    footerStatusEl.textContent = `Ouvert : ${file.basename}`;
    clearStatusAfter(1500);
  } catch (openErr) {
    try {
      await browser.downloads.show(file.id);
      footerStatusEl.textContent = `Dossier ouvert : ${file.basename}`;
      clearStatusAfter(1500);
    } catch (showErr) {
      if (canPreviewFromUrl(file.url)) {
        await browser.tabs.create({ url: file.url, active: true });
        footerStatusEl.textContent = `Ouvert : ${file.basename}`;
        clearStatusAfter(1500);
      } else {
        console.error('[organizer] Open failed:', openErr, showErr);
        footerStatusEl.textContent = `Erreur ouverture : ${file.basename}`;
        clearStatusAfter(3000);
      }
    }
  }
}

function clearStatusAfter(ms: number): void {
  setTimeout(() => {
    if (
      footerStatusEl.textContent?.includes('Supprimé') ||
      footerStatusEl.textContent?.includes('Archivé') ||
      footerStatusEl.textContent?.includes('Archivage') ||
      footerStatusEl.textContent?.includes('Ouvert') ||
      footerStatusEl.textContent?.includes('Dossier') ||
      footerStatusEl.textContent?.includes('Erreur') ||
      footerStatusEl.textContent?.includes('Impossible')
    ) {
      footerStatusEl.textContent = '';
    }
  }, ms);
}

function closeAllSelects(except?: Element): void {
  document.querySelectorAll('.select-wrap.is-open').forEach((wrap) => {
    if (wrap === except) return;
    wrap.classList.remove('is-open');
    const btn = wrap.querySelector<HTMLButtonElement>('.select-wrap__btn');
    const menu = wrap.querySelector<HTMLElement>('.select-menu');
    btn?.setAttribute('aria-expanded', 'false');
    if (menu) menu.hidden = true;
  });
}

function enhanceSelect(select: HTMLSelectElement | null): void {
  if (!select) return;
  const wrap = select.closest('.select-wrap');
  if (!wrap || wrap.querySelector('.select-wrap__btn')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'select-wrap__btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  const label = select.getAttribute('aria-label') || '';
  if (label) btn.setAttribute('aria-label', label);

  const valueEl = document.createElement('span');
  valueEl.className = 'select-wrap__value';
  btn.append(valueEl);

  const menu = document.createElement('ul');
  menu.className = 'select-menu';
  menu.id = `${select.id}-menu`;
  menu.setAttribute('role', 'listbox');
  if (label) menu.setAttribute('aria-label', label);
  menu.hidden = true;
  btn.setAttribute('aria-controls', menu.id);

  wrap.append(btn, menu);

  let activeIndex = select.selectedIndex;

  function optionEls(): HTMLElement[] {
    return [...menu.querySelectorAll<HTMLElement>('[role="option"]')];
  }

  function syncLabel(): void {
    valueEl.textContent = select.options[select.selectedIndex]?.textContent ?? '';
  }

  function syncOptions(): void {
    optionEls().forEach((el, i) => {
      const selected = i === select.selectedIndex;
      el.classList.toggle('is-selected', selected);
      el.classList.toggle('is-active', i === activeIndex);
      el.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
  }

  function rebuildMenu(): void {
    menu.replaceChildren(
      ...[...select.options].map((opt) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.dataset.value = opt.value;
        li.textContent = opt.textContent ?? opt.value;
        return li;
      }),
    );
    activeIndex = select.selectedIndex;
    syncLabel();
    syncOptions();
  }

  function close(): void {
    wrap.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    menu.hidden = true;
  }

  function open(): void {
    closeAllSelects(wrap);
    rebuildMenu();
    menu.hidden = false;
    wrap.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    optionEls()[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function choose(index: number): void {
    const opt = select.options[index];
    if (!opt) return;
    select.selectedIndex = index;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    syncLabel();
    close();
    btn.focus();
  }

  function moveActive(delta: number): void {
    const count = select.options.length;
    if (count === 0) return;
    activeIndex = (activeIndex + delta + count) % count;
    syncOptions();
    optionEls()[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (wrap.classList.contains('is-open')) close();
    else open();
  });

  menu.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
  });

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const opt = (e.target as HTMLElement).closest('[role="option"]');
    if (!(opt instanceof HTMLElement)) return;
    const index = optionEls().indexOf(opt);
    if (index >= 0) choose(index);
  });

  menu.addEventListener('pointermove', (e) => {
    const opt = (e.target as HTMLElement).closest('[role="option"]');
    if (!(opt instanceof HTMLElement)) return;
    const index = optionEls().indexOf(opt);
    if (index < 0 || index === activeIndex) return;
    activeIndex = index;
    syncOptions();
  });

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (!wrap.classList.contains('is-open')) open();
      moveActive(e.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      if (wrap.classList.contains('is-open')) {
        e.preventDefault();
        e.stopPropagation();
        choose(activeIndex);
      }
      return;
    }
    if (e.key === 'Escape' && wrap.classList.contains('is-open')) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
    if (e.key === 'Home' && wrap.classList.contains('is-open')) {
      e.preventDefault();
      activeIndex = 0;
      syncOptions();
    }
    if (e.key === 'End' && wrap.classList.contains('is-open')) {
      e.preventDefault();
      activeIndex = Math.max(0, select.options.length - 1);
      syncOptions();
    }
  });

  select.addEventListener('change', () => {
    syncLabel();
    syncOptions();
  });

  rebuildMenu();
}

function setupCustomSelects(): void {
  enhanceSelect(sortSelect);
  enhanceSelect(filterSelect);
}

function handleKeydown(e: KeyboardEvent): void {
  if (
    (e.target instanceof HTMLInputElement && e.target.type !== 'checkbox') ||
    e.target instanceof HTMLSelectElement ||
    e.target instanceof HTMLTextAreaElement
  ) {
    if (e.key === 'Escape') {
      (e.target as HTMLElement).blur();
    }
    return;
  }

  if (settingsDialog.open || confirmDialog.open) return;
  if (document.querySelector('.select-wrap.is-open')) {
    if (e.key === 'Escape') closeAllSelects();
    return;
  }
  const selectBtn = e.target instanceof HTMLElement ? e.target.closest('.select-wrap__btn') : null;
  if (selectBtn) return;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    if (filteredFiles.length > 0) selectAllVisible(true);
    return;
  }

  if (e.key === 'Escape' && checkedIds.size > 0) {
    e.preventDefault();
    selectAllVisible(false);
    return;
  }

  if ((e.key === 'Enter' || e.key === ' ') && e.target instanceof HTMLButtonElement) {
    return;
  }

  const hasTarget = selectedIndex >= 0 || checkedIds.size > 0;
  const action = keyToAction(e.key, hasTarget);
  if (!action) return;

  e.preventDefault();

  switch (action.type) {
    case 'delete':
      void deleteChecked();
      break;
    case 'archive':
      void archiveChecked();
      break;
    case 'open':
      handleAction('open', selectedIndex);
      break;
    case 'next':
      if (selectedIndex < filteredFiles.length - 1) selectItem(selectedIndex + 1);
      break;
    case 'select-first':
      if (filteredFiles.length > 0) selectItem(0);
      break;
    case 'select-last':
      if (filteredFiles.length > 0) selectItem(filteredFiles.length - 1);
      break;
    case 'escape': {
      const prevEl = fileListEl.querySelector('.file-item--selected');
      prevEl?.classList.remove('file-item--selected');
      selectedIndex = -1;
      selectedId = null;
      break;
    }
  }
}

async function loadSettings(): Promise<void> {
  archiveFolder = await getArchiveFolder();
  previewEnabled = await isPreviewEnabled();
  lazyPreviewEnabled = await isLazyPreviewEnabled();

  archiveFolderInput.value = archiveFolder;
  archivePreviewEl.textContent = `Aperçu : Téléchargements/${archiveFolder}/`;
  previewEnabledInput.checked = previewEnabled;
  lazyPreviewInput.checked = lazyPreviewEnabled;
}

async function saveSettings(): Promise<void> {
  const folder = archiveFolderInput.value.trim() || 'Archives';
  await setArchiveFolder(folder);
  await setPreviewEnabled(previewEnabledInput.checked);
  await setLazyPreviewEnabled(lazyPreviewInput.checked);

  archiveFolder = folder;
  previewEnabled = previewEnabledInput.checked;
  lazyPreviewEnabled = lazyPreviewInput.checked;

  archivePreviewEl.textContent = `Aperçu : Téléchargements/${archiveFolder}/`;
  settingsDialog.close();
  void loadDownloads();
}

function setupEventListeners(): void {
  if (listenersBound) return;
  listenersBound = true;
  setupCustomSelects();

  document.addEventListener('pointerdown', (e) => {
    const target = e.target as HTMLElement | null;
    if (target?.closest('.select-wrap')) return;
    closeAllSelects();
  });

  fileListEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const itemEl = target.closest('.file-item');
    if (!itemEl) return;
    const index = parseInt(itemEl.getAttribute('data-index')!, 10);

    const btn = target.closest('.action-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      handleAction(btn.getAttribute('data-action')!, index);
      return;
    }

    const check = target.closest('.file-check-wrap');
    if (check) {
      e.preventDefault();
      e.stopPropagation();
      toggleChecked(index, e.shiftKey);
      selectItem(index);
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      toggleChecked(index, false);
      selectItem(index);
      return;
    }

    if (e.shiftKey && lastCheckedIndex >= 0) {
      toggleChecked(index, true);
      selectItem(index);
      return;
    }

    selectItem(index);
  });

  fileListEl.addEventListener('dblclick', (e) => {
    if ((e.target as HTMLElement).closest('.file-check-wrap')) return;
    const itemEl = (e.target as HTMLElement).closest('.file-item');
    if (!itemEl) return;
    const index = parseInt(itemEl.getAttribute('data-index')!, 10);
    void openFile(index);
  });

  grantFolderBtn.addEventListener('click', () => {
    const intent = dirHandles.length > 0 && folderPermission !== 'granted' ? 'restore' : 'add';
    void connectDownloadsFolder(intent);
  });
  folderAccessBtn.addEventListener('click', () => {
    void connectDownloadsFolder('add');
  });
  folderListEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-kind]');
    if (!btn) return;
    const kind = btn.getAttribute('data-kind');
    const index = Number(btn.getAttribute('data-index'));
    if ((kind !== 'handle' && kind !== 'session') || Number.isNaN(index)) return;
    void removeConnectedFolder(kind, index);
  });

  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes[DOWNLOADS_FOLDER_LINKED_KEY]) return;
      void (async () => {
        try {
          dirHandles = await loadDirHandles();
        } catch {
          dirHandles = [];
        }
        try {
          sessionGroups = await loadSessionFolderGroups();
        } catch {
          sessionGroups = [];
        }
        await refreshFolderPermission();
        lastListSnapshot = null;
        void loadDownloads();
      })();
  });

  refreshBtn.addEventListener('click', () => {
    hiddenIds.clear();
    lastListSnapshot = null;
    void loadDownloads();
  });
  settingsBtn.addEventListener('click', () => settingsDialog.showModal());
  confirmDialog.addEventListener(
    'click',
    (e) => {
      if (Date.now() < confirmIgnoreUntil) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.target === confirmDialog) confirmDialog.close('cancel');
    },
    true,
  );
  confirmDialog.querySelector('form')?.addEventListener('submit', (e) => {
    if (Date.now() < confirmIgnoreUntil) e.preventDefault();
  });
  saveSettingsBtn.addEventListener('click', () => {
    void saveSettings();
  });

  sortSelect.addEventListener('change', () => {
    currentSort = sortSelect.value;
    applyFilterAndSort();
    selectedIndex = -1;
    selectedId = null;
    updateUI();
  });

  filterSelect.addEventListener('change', () => {
    currentFilter = filterSelect.value;
    applyFilterAndSort();
    selectedIndex = -1;
    selectedId = null;
    updateUI();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim();
    applyFilterAndSort();
    selectedIndex = -1;
    selectedId = null;
    updateUI();
  });

  selectAllInput.addEventListener('change', () => {
    selectAllVisible(selectAllInput.checked);
  });

  bulkDeleteBtn.addEventListener('click', () => {
    void deleteChecked();
  });

  bulkArchiveBtn.addEventListener('click', () => {
    void archiveChecked();
  });

  archiveFolderInput.addEventListener('input', () => {
    const folder = archiveFolderInput.value.trim() || 'Archives';
    archivePreviewEl.textContent = `Aperçu : Téléchargements/${folder}/`;
  });

  document.addEventListener('keydown', handleKeydown);

  browser.downloads.onCreated.addListener((item) => {
    if (ignoreCompleteIds.has(item.id)) return;
    scheduleReload();
  });

  browser.downloads.onChanged.addListener((delta) => {
    if (ignoreCompleteIds.has(delta.id)) return;
    if (!isRelevantDownloadDelta(delta)) return;
    scheduleReload();
  });

  browser.downloads.onErased.addListener((id) => {
    hiddenIds.delete(id);
    checkedIds.delete(id);
    allFiles = allFiles.filter((f) => f.id !== id);
    lastListSnapshot = null;
    applyFilterAndSort();
    restoreSelection();
    updateUI();
  });

  browser.runtime.onMessage.addListener((message) => {
    if (
      typeof message === 'object' &&
      message !== null &&
      'type' in message &&
      message.type === DOWNLOADS_CHANGED_MESSAGE
    ) {
      scheduleReload();
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    void (async () => {
      await refreshFolderPermission();
      scheduleReload();
    })();
  });

  window.setInterval(() => {
    if (document.visibilityState !== 'visible') return;
    scheduleReload();
  }, 4000);
}

async function init(): Promise<void> {
  await loadSettings();
  try {
    dirHandles = await loadDirHandles();
  } catch {
    dirHandles = [];
  }
  try {
    sessionGroups = await loadSessionFolderGroups();
  } catch {
    sessionGroups = [];
  }
  await refreshFolderPermission();
  setupEventListeners();
  await loadDownloads();

  if (filteredFiles.length > 0) {
    selectItem(0);
  }
}

void init();
