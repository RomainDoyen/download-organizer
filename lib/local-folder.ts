export const LOCAL_FOLDER_MAX_DEPTH = 5;
export const LOCAL_FOLDER_MAX_FILES = 2500;

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '$recycle.bin',
  'system volume information',
]);

const SKIP_FILES = new Set(['thumbs.db', 'desktop.ini', '.ds_store']);

export type LocalFileRecord = {
  relativePath: string;
  name: string;
  size: number;
  lastModified: number;
  mime: string;
  folderName?: string;
  handle?: FileSystemFileHandle;
  parent?: FileSystemDirectoryHandle;
  root?: FileSystemDirectoryHandle;
  file?: File;
};

export function normalizeRelPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/g, '').replace(/\/+$/g, '');
}

export function chromePathMatchesRelative(chromeFilename: string, relativePath: string): boolean {
  const full = normalizeRelPath(chromeFilename).toLowerCase();
  const rel = normalizeRelPath(relativePath).toLowerCase();
  if (!rel) return false;
  return full === rel || full.endsWith(`/${rel}`);
}

export function fsStableId(relativePath: string): number {
  const key = normalizeRelPath(relativePath);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return -1 - (hash >>> 0) % 0x7fffffff;
}

export function mergeUncoveredFsItems<T extends { relativePath: string }>(
  chromeFilenames: string[],
  fsItems: T[],
): T[] {
  return fsItems.filter(
    (item) => !chromeFilenames.some((filename) => chromePathMatchesRelative(filename, item.relativePath)),
  );
}

export function shouldSkipDirName(name: string, archiveFolder: string, depth: number): boolean {
  const n = name.toLowerCase();
  if (!n || n.startsWith('.')) return true;
  if (SKIP_DIRS.has(n)) return true;
  if (depth === 0 && name === archiveFolder) return true;
  return false;
}

export function shouldSkipFileName(name: string): boolean {
  return SKIP_FILES.has(name.toLowerCase());
}

export function relativePathFromWebkitPath(webkitRelativePath: string, fallbackName: string): string {
  const normalized = normalizeRelPath(webkitRelativePath || fallbackName);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return fallbackName;
  if (parts.length === 1) return parts[0] ?? fallbackName;
  return parts.slice(1).join('/');
}

export function shouldSkipLocalRelativePath(relativePath: string, archiveFolder: string): boolean {
  const parts = normalizeRelPath(relativePath).split('/').filter(Boolean);
  if (parts.length === 0) return true;
  if (shouldSkipFileName(parts[parts.length - 1] ?? '')) return true;
  if (parts.length >= 2 && shouldSkipDirName(parts[0] ?? '', archiveFolder, 0)) return true;
  if (parts.length > LOCAL_FOLDER_MAX_DEPTH + 1) return true;
  return false;
}

export function folderNameFromFiles(files: File[]): string {
  const path = files[0]?.webkitRelativePath || files[0]?.name || '';
  const first = normalizeRelPath(path).split('/').filter(Boolean)[0];
  return first || 'Dossier';
}

export function folderRecordKey(folderName: string, relativePath: string): string {
  return `${normalizeRelPath(folderName)}::${normalizeRelPath(relativePath)}`;
}

export function uniqueDisplayName(name: string, existing: string[]): string {
  const used = new Set(existing.map((item) => item.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${name} (${i})`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return `${name}-${Date.now()}`;
}

export function localRecordsFromFiles(
  files: File[],
  archiveFolder: string,
  folderName?: string,
): LocalFileRecord[] {
  const name = folderName || folderNameFromFiles(files);
  const out: LocalFileRecord[] = [];
  for (const file of files) {
    if (out.length >= LOCAL_FOLDER_MAX_FILES) break;
    const relativePath = relativePathFromWebkitPath(file.webkitRelativePath || file.name, file.name);
    if (shouldSkipLocalRelativePath(relativePath, archiveFolder)) continue;
    out.push({
      relativePath,
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
      mime: file.type,
      folderName: name,
      file,
    });
  }
  return out;
}

export function canMutateLocalFile(record: LocalFileRecord): boolean {
  return Boolean(record.handle && record.parent);
}

export async function getLocalFileBlob(record: LocalFileRecord): Promise<Blob> {
  if (record.file) return record.file;
  if (record.handle) return record.handle.getFile();
  throw new Error('no-file');
}

/** Accès persistant (Chrome, Edge, Opera, Vivaldi, Brave si le flag est activé). */
export function isFolderAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

export function isDirectoryInputSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const input = document.createElement('input');
  input.type = 'file';
  return 'webkitdirectory' in input;
}

export function looksLikeBrave(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & {
    brave?: unknown;
    userAgentData?: { brands?: { brand: string }[] };
  };
  if (nav.brave) return true;
  if (nav.userAgentData?.brands?.some((item) => /brave/i.test(item.brand))) return true;
  return /Brave/i.test(navigator.userAgent);
}

/** Chromium sans showDirectoryPicker : souvent Brave (flag off) ou un fork verrouillé. */
export function needsChromiumFolderFlag(): boolean {
  if (isFolderAccessSupported()) return false;
  if (typeof navigator === 'undefined') return false;
  if (/Firefox|FxiOS/i.test(navigator.userAgent)) return false;
  return looksLikeBrave() || /Chrome|Chromium|Edg|OPR|Vivaldi|Brave/i.test(navigator.userAgent);
}

export function chromiumFolderFlagHint(): string {
  if (looksLikeBrave()) {
    return 'Sur Brave, ouvrez brave://flags/#file-system-access-api, passez sur Enabled, puis relancez le navigateur. Ensuite l’accès reste mémorisé.';
  }
  return 'Si le sélecteur avancé est indisponible (Brave, certains Chromium), activez File System Access API dans les flags du navigateur, ou choisissez le dossier via la fenêtre de fichiers.';
}

export async function pickDownloadsFolderViaInput(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.setAttribute('webkitdirectory', '');
    input.setAttribute('directory', '');
    let settled = false;
    const finish = (files: File[]) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('focus', onFocus);
      resolve(files);
    };
    const onFocus = (): void => {
      window.setTimeout(() => finish(Array.from(input.files ?? [])), 400);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])));
    window.addEventListener('focus', onFocus);
    input.click();
  });
}

export async function listLocalDownloadFiles(
  root: FileSystemDirectoryHandle,
  archiveFolder: string,
): Promise<LocalFileRecord[]> {
  const out: LocalFileRecord[] = [];
  await walkDir(root, '', 0, archiveFolder, out);
  return out.map((record) => ({
    ...record,
    folderName: root.name,
    root,
  }));
}

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  depth: number,
  archiveFolder: string,
  out: LocalFileRecord[],
): Promise<void> {
  if (depth > LOCAL_FOLDER_MAX_DEPTH || out.length >= LOCAL_FOLDER_MAX_FILES) return;

  for await (const [name, handle] of dir.entries()) {
    if (out.length >= LOCAL_FOLDER_MAX_FILES) return;

    if (handle.kind === 'directory') {
      if (shouldSkipDirName(name, archiveFolder, depth)) continue;
      const nextPrefix = prefix ? `${prefix}/${name}` : name;
      await walkDir(handle, nextPrefix, depth + 1, archiveFolder, out);
      continue;
    }

    if (shouldSkipFileName(name)) continue;

    try {
      const file = await handle.getFile();
      const relativePath = prefix ? `${prefix}/${name}` : name;
      out.push({
        relativePath,
        name,
        size: file.size,
        lastModified: file.lastModified,
        mime: file.type,
        handle,
        parent: dir,
      });
    } catch {
      /* fichier verrouillé / inaccessible */
    }
  }
}

export async function queryFolderPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = 'readwrite',
): Promise<PermissionState> {
  return handle.queryPermission({ mode });
}

export async function requestFolderPermission(
  handle: FileSystemDirectoryHandle,
  mode: FileSystemPermissionMode = 'readwrite',
): Promise<PermissionState> {
  return handle.requestPermission({ mode });
}

export async function pickDownloadsFolder(): Promise<FileSystemDirectoryHandle> {
  return window.showDirectoryPicker({
    id: 'download-organizer-downloads',
    mode: 'readwrite',
    startIn: 'downloads',
  });
}

export async function removeLocalFile(record: LocalFileRecord): Promise<void> {
  if (!record.parent) throw new Error('read-only-folder-access');
  await record.parent.removeEntry(record.name);
}

export async function archiveLocalFile(
  root: FileSystemDirectoryHandle,
  record: LocalFileRecord,
  archiveFolder: string,
): Promise<void> {
  if (!record.handle || !record.parent) throw new Error('read-only-folder-access');
  const destDir = await root.getDirectoryHandle(archiveFolder, { create: true });
  const destName = await uniqueName(destDir, record.name);
  const movable = record.handle as FileSystemFileHandle & {
    move?: (dir: FileSystemDirectoryHandle, name?: string) => Promise<void>;
  };
  if (typeof movable.move === 'function') {
    await movable.move(destDir, destName);
    return;
  }

  const file = record.file ?? (await record.handle.getFile());
  const dest = await destDir.getFileHandle(destName, { create: true });
  const writable = await dest.createWritable();
  await writable.write(file);
  await writable.close();
  await record.parent.removeEntry(record.name);
}

async function uniqueName(dir: FileSystemDirectoryHandle, name: string): Promise<string> {
  try {
    await dir.getFileHandle(name);
  } catch {
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let i = 1; i < 1000; i++) {
    const candidate = `${base} (${i})${ext}`;
    try {
      await dir.getFileHandle(candidate);
    } catch {
      return candidate;
    }
  }
  return `${base}-${Date.now()}${ext}`;
}
