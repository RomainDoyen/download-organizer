export const DOWNLOADS_FOLDER_LINKED_KEY = 'downloadsFolderLinkedAt';
const DB_NAME = 'download-organizer-fs';
const STORE = 'kv';
const HANDLE_KEY = 'downloads-dir';
const HANDLES_KEY = 'downloads-dirs';
const FILES_KEY = 'session-folder-files';
const GROUPS_KEY = 'session-folder-groups';

export type SessionFolderGroup = { name: string; files: File[] };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB'));
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  const value = await new Promise<T | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read'));
  });
  db.close();
  return value;
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write'));
    tx.objectStore(STORE).put(value, key);
  });
  db.close();
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB delete'));
    tx.objectStore(STORE).delete(key);
  });
  db.close();
}

export async function loadDirHandles(): Promise<FileSystemDirectoryHandle[]> {
  const many = await idbGet<FileSystemDirectoryHandle[]>(HANDLES_KEY);
  if (Array.isArray(many)) return many;
  const one = await idbGet<FileSystemDirectoryHandle>(HANDLE_KEY);
  return one ? [one] : [];
}

export async function saveDirHandles(handles: FileSystemDirectoryHandle[]): Promise<void> {
  await idbPut(HANDLES_KEY, handles);
  await idbDelete(HANDLE_KEY);
}

export async function addDirHandle(handle: FileSystemDirectoryHandle): Promise<FileSystemDirectoryHandle[]> {
  const current = await loadDirHandles();
  for (const existing of current) {
    try {
      if (await existing.isSameEntry(handle)) return current;
    } catch {
      /* ignore */
    }
  }
  const next = [...current, handle];
  await saveDirHandles(next);
  return next;
}

export async function removeDirHandleAt(index: number): Promise<FileSystemDirectoryHandle[]> {
  const next = (await loadDirHandles()).filter((_, i) => i !== index);
  await saveDirHandles(next);
  return next;
}

/** @deprecated un seul handle — conservé pour l’ancien stockage */
export async function saveDownloadsDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await addDirHandle(handle);
}

export async function loadDownloadsDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const handles = await loadDirHandles();
  return handles[0] ?? null;
}

export async function loadSessionFolderGroups(): Promise<SessionFolderGroup[]> {
  const groups = await idbGet<SessionFolderGroup[]>(GROUPS_KEY);
  if (Array.isArray(groups)) return groups;
  const files = await idbGet<File[]>(FILES_KEY);
  if (files && files.length > 0) {
    return [{ name: files[0]?.webkitRelativePath?.split(/[/\\]/)[0] || 'Dossier', files }];
  }
  return [];
}

export async function saveSessionFolderGroups(groups: SessionFolderGroup[]): Promise<void> {
  await idbPut(GROUPS_KEY, groups);
  await idbDelete(FILES_KEY);
}

export async function addSessionFolderGroup(group: SessionFolderGroup): Promise<SessionFolderGroup[]> {
  const current = await loadSessionFolderGroups();
  const next = [...current, group];
  await saveSessionFolderGroups(next);
  return next;
}

export async function removeSessionFolderGroupAt(index: number): Promise<SessionFolderGroup[]> {
  const next = (await loadSessionFolderGroups()).filter((_, i) => i !== index);
  await saveSessionFolderGroups(next);
  return next;
}

export async function saveSessionFolderFiles(files: File[]): Promise<void> {
  const name = files[0]?.webkitRelativePath?.split(/[/\\]/)[0] || 'Dossier';
  await addSessionFolderGroup({ name, files });
}

export async function loadSessionFolderFiles(): Promise<File[]> {
  const groups = await loadSessionFolderGroups();
  return groups.flatMap((group) => group.files);
}
