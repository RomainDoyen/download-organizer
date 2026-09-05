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
let listenersBound = false;

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
const sortWrap = document.getElementById('sort-select-wrap')!;
const filterWrap = document.getElementById('filter-select-wrap')!;
const searchInput = document.getElementById('search-input') as HTMLInputElement;
const refreshBtn = document.getElementById('refresh-btn')!;
const settingsBtn = document.getElementById('settings-btn')!;
const settingsDialog = document.getElementById('settings-dialog') as HTMLDialogElement;
const archiveFolderInput = document.getElementById('archive-folder-input') as HTMLInputElement;
const archivePreviewEl = document.getElementById('archive-preview')!;
const previewEnabledInput = document.getElementById('preview-enabled') as HTMLInputElement;
const lazyPreviewInput = document.getElementById('preview-lazy') as HTMLInputElement;
const saveSettingsBtn = document.getElementById('save-settings')!;

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
  };
}

async function loadDownloads(): Promise<void> {
  if (isLoading) return;
  isLoading = true;
  showLoading(true);

  try {
    const downloads = await browser.downloads.search({
      limit: 10000,
      orderBy: ['-startTime'],
    });

    allFiles = downloads
      .filter((d) => d.state === 'complete' && d.filename)
      .filter((d) => d.exists !== false)
      .filter((d) => !hiddenIds.has(d.id!))
      .filter((d) => !isUnderFolder(d.filename || '', archiveFolder))
      .map(createFileEntry);

    applyFilterAndSort();
    restoreSelection();
  } catch (err) {
    console.error('[organizer] Failed to load downloads:', err);
    footerStatusEl.textContent = 'Erreur lors du chargement';
  } finally {
    isLoading = false;
    showLoading(false);
    updateUI();
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

async function deleteChecked(): Promise<void> {
  const targets = getCheckedTargets();
  for (const file of targets) {
    const index = filteredFiles.findIndex((f) => f.id === file.id);
    if (index >= 0) await deleteFile(index);
  }
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
    case 'delete':
      void deleteFile(index);
      break;
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
    try {
      await browser.downloads.removeFile(file.id);
    } catch {
      /* déjà absent du disque */
    }
    await browser.downloads.erase({ id: file.id });
    footerStatusEl.textContent = `Supprimé : ${file.basename}`;
    clearStatusAfter(2000);
  } catch (err) {
    console.error('[organizer] Delete failed:', err);
    restoreDismissed(file);
    footerStatusEl.textContent = `Erreur : ${file.basename}`;
    clearStatusAfter(3000);
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

  if ((e.target as HTMLElement).closest?.('.select-wrap')) {
    return;
  }

  if (settingsDialog.open) return;

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

function closeAllSelects(except?: HTMLElement): void {
  document.querySelectorAll<HTMLElement>('.select-wrap.is-open').forEach((wrap) => {
    if (wrap === except) return;
    wrap.classList.remove('is-open');
    wrap.querySelector('.select-trigger')?.setAttribute('aria-expanded', 'false');
    const menu = wrap.querySelector<HTMLElement>('.select-menu');
    if (menu) menu.hidden = true;
  });
}

function setupCustomSelects(): void {
  document.querySelectorAll<HTMLElement>('.select-wrap').forEach((wrap) => {
    const trigger = wrap.querySelector<HTMLButtonElement>('.select-trigger');
    const menu = wrap.querySelector<HTMLElement>('.select-menu');
    const label = wrap.querySelector<HTMLElement>('.select-trigger__label');
    if (!trigger || !menu || !label) return;

    const close = (): void => {
      wrap.classList.remove('is-open');
      trigger.setAttribute('aria-expanded', 'false');
      menu.hidden = true;
    };

    const open = (): void => {
      closeAllSelects(wrap);
      wrap.classList.add('is-open');
      trigger.setAttribute('aria-expanded', 'true');
      menu.hidden = false;
    };

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wrap.classList.contains('is-open')) close();
      else open();
    });

    menu.addEventListener('click', (e) => {
      const option = (e.target as HTMLElement).closest('[role="option"]');
      if (!option) return;
      e.stopPropagation();
      const value = option.getAttribute('data-value') ?? '';
      menu.querySelectorAll('[role="option"]').forEach((o) => o.setAttribute('aria-selected', 'false'));
      option.setAttribute('aria-selected', 'true');
      label.textContent = option.textContent?.trim() ?? '';
      wrap.dataset.value = value;
      close();
      wrap.dispatchEvent(new CustomEvent('select-change', { detail: { value } }));
    });
  });

  document.addEventListener('click', () => closeAllSelects());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllSelects();
  });
}

function bindListListeners(): void {
  if (listenersBound) return;
  listenersBound = true;

  fileListEl.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const itemEl = target.closest('.file-item');
    if (!itemEl) return;
    const index = parseInt(itemEl.getAttribute('data-index')!, 10);

    const btn = target.closest('.action-btn');
    if (btn) {
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
}

function setupEventListeners(): void {
  refreshBtn.addEventListener('click', () => {
    hiddenIds.clear();
    void loadDownloads();
  });
  settingsBtn.addEventListener('click', () => settingsDialog.showModal());
  saveSettingsBtn.addEventListener('click', () => {
    void saveSettings();
  });

  setupCustomSelects();

  sortWrap.addEventListener('select-change', ((e: CustomEvent<{ value: string }>) => {
    currentSort = e.detail.value;
    applyFilterAndSort();
    selectedIndex = -1;
    selectedId = null;
    updateUI();
  }) as EventListener);

  filterWrap.addEventListener('select-change', ((e: CustomEvent<{ value: string }>) => {
    currentFilter = e.detail.value;
    applyFilterAndSort();
    selectedIndex = -1;
    selectedId = null;
    updateUI();
  }) as EventListener);

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
  bindListListeners();

  browser.downloads.onChanged.addListener((delta) => {
    if (delta.state?.current !== 'complete') return;
    if (ignoreCompleteIds.has(delta.id)) return;
    void loadDownloads();
  });

  browser.downloads.onErased.addListener((id) => {
    hiddenIds.delete(id);
    checkedIds.delete(id);
    allFiles = allFiles.filter((f) => f.id !== id);
    applyFilterAndSort();
    restoreSelection();
    updateUI();
  });
}

async function init(): Promise<void> {
  await loadSettings();
  setupEventListeners();
  await loadDownloads();

  if (filteredFiles.length > 0) {
    selectItem(0);
  }
}

void init();
