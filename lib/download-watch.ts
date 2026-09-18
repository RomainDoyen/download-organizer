export const DOWNLOADS_CHANGED_MESSAGE = 'downloads-changed' as const;

export type DownloadWatchItem = {
  id: number;
  filename: string;
  state: string;
  exists: boolean;
  fileSize: number;
};

export type DownloadWatchDelta = {
  filename?: unknown;
  state?: unknown;
  exists?: unknown;
  fileSize?: unknown;
  endTime?: unknown;
  bytesReceived?: unknown;
};

export function downloadFingerprint(item: DownloadWatchItem): string {
  return [
    item.id,
    item.filename.replace(/\\/g, '/'),
    item.state,
    item.exists ? '1' : '0',
    String(item.fileSize),
  ].join('\0');
}

export function downloadsSnapshot(items: readonly DownloadWatchItem[]): string {
  return items.map(downloadFingerprint).sort().join('\n');
}

export function hasDownloadsChanged(prev: string, next: string): boolean {
  return prev !== next;
}

/** Les deltas de progression (bytesReceived) sont trop fréquents pour rafraîchir l’UI. */
export function isRelevantDownloadDelta(delta: DownloadWatchDelta): boolean {
  return (
    delta.filename !== undefined ||
    delta.state !== undefined ||
    delta.exists !== undefined ||
    delta.fileSize !== undefined ||
    delta.endTime !== undefined
  );
}

export function toWatchItem(item: {
  id?: number;
  filename?: string;
  state?: string;
  exists?: boolean;
  fileSize?: number;
}): DownloadWatchItem | null {
  if (item.id == null) return null;
  return {
    id: item.id,
    filename: item.filename ?? '',
    state: item.state ?? '',
    exists: item.exists !== false,
    fileSize: item.fileSize ?? 0,
  };
}
