export const SORT_FOLDERS = new Set([
  'Images',
  'Vidéos',
  'Audios',
  'Documents',
  'Autres',
]);

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const MEDIA_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'avif',
  'bmp',
  'svg',
  'ico',
  'tif',
  'tiff',
  'mp4',
  'webm',
  'mov',
  'm4v',
  'ogv',
  'mkv',
]);

export function mediaExtensionFromUrl(url: string): string | undefined {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const last = path.split('/').pop() ?? '';
    const ext = last.includes('.') ? last.split('.').pop() : '';
    return ext && MEDIA_EXTENSIONS.has(ext) ? ext : undefined;
  } catch {
    return undefined;
  }
}

export function isSafePreviewMime(mime: string): boolean {
  const t = mime.split(';')[0].trim().toLowerCase();
  if (!t) return true;
  if (
    t.startsWith('text/html') ||
    t === 'application/xhtml+xml' ||
    t.includes('javascript') ||
    t === 'application/json' ||
    t === 'text/css'
  ) {
    return false;
  }
  return true;
}

export function isSafeMediaContentType(type: string, kind: 'image' | 'video'): boolean {
  const t = type.split(';')[0].trim().toLowerCase();
  if (!t) return false;
  if (
    t.startsWith('text/') ||
    t.includes('javascript') ||
    t === 'application/json' ||
    t === 'application/xhtml+xml'
  ) {
    return false;
  }
  return kind === 'image' ? t.startsWith('image/') : t.startsWith('video/');
}

/** Aperçu distant uniquement si l’URL pointe vers un vrai fichier média, pas une page HTML. */
export function canPreviewFromUrl(url: string, mime = ''): boolean {
  if (!url.startsWith('https://') && !url.startsWith('http://')) return false;
  if (!isSafePreviewMime(mime)) return false;
  return mediaExtensionFromUrl(url) !== undefined;
}

export function canArchiveFromUrl(url: string): boolean {
  return canPreviewFromUrl(url);
}

export function shouldCancelBeforeArchive(state: string): boolean {
  return state === 'in_progress';
}

export function archiveRelativePath(folder: string, basename: string): string {
  const clean = folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') || 'Archives';
  return `${clean}/${basename}`;
}

export function parentFolderName(filename: string): string | undefined {
  const parts = filename.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length < 2) return undefined;
  return parts[parts.length - 2];
}

export function isUnderFolder(filename: string, folder: string): boolean {
  const parent = parentFolderName(filename);
  return parent === folder.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

export function isAlreadyUnderSortFolder(filename: string): boolean {
  const parent = parentFolderName(filename);
  return parent !== undefined && SORT_FOLDERS.has(parent);
}

export function shouldPreserveSuggestedFilename(opts: {
  byExtensionId?: string;
  filename: string;
  archiveFolder: string;
}): boolean {
  if (opts.byExtensionId) return true;
  if (isAlreadyUnderSortFolder(opts.filename)) return true;
  if (isUnderFolder(opts.filename, opts.archiveFolder)) return true;
  return false;
}

export type KeyboardAction =
  | { type: 'delete' }
  | { type: 'archive' }
  | { type: 'open' }
  | { type: 'next' }
  | { type: 'select-first' }
  | { type: 'select-last' }
  | { type: 'escape' };

export function keyToAction(
  key: string,
  hasSelection: boolean,
): KeyboardAction | null {
  switch (key) {
    case 'ArrowLeft':
    case 'Delete':
    case 'Backspace':
      return hasSelection ? { type: 'delete' } : null;
    case 'ArrowRight':
      return hasSelection ? { type: 'archive' } : null;
    case 'ArrowUp':
      return hasSelection ? { type: 'open' } : { type: 'select-first' };
    case 'ArrowDown':
      return hasSelection ? { type: 'next' } : { type: 'select-first' };
    case 'Home':
      return { type: 'select-first' };
    case 'End':
      return { type: 'select-last' };
    case 'Enter':
    case ' ':
      return hasSelection ? { type: 'open' } : null;
    case 'Escape':
      return hasSelection ? { type: 'escape' } : null;
    default:
      return null;
  }
}

export function indicesInRange(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(i);
  return out;
}
