import { describe, expect, test } from 'vitest';
import {
  downloadsSnapshot,
  hasDownloadsChanged,
  isRelevantDownloadDelta,
} from './download-watch';

const rootFile = {
  id: 1,
  filename: 'C:\\Users\\x\\Downloads\\photo.jpg',
  state: 'complete',
  exists: true,
  fileSize: 100,
};

const folderFile = {
  id: 2,
  filename: 'C:\\Users\\x\\Downloads\\Images\\photo.jpg',
  state: 'complete',
  exists: true,
  fileSize: 100,
};

describe('downloadsSnapshot', () => {
  test('change quand un fichier passe de la racine Téléchargements vers un sous-dossier', () => {
    const before = downloadsSnapshot([rootFile]);
    const after = downloadsSnapshot([{ ...rootFile, filename: folderFile.filename }]);
    expect(hasDownloadsChanged(before, after)).toBe(true);
  });

  test('change quand un fichier apparaît dans un sous-dossier', () => {
    const before = downloadsSnapshot([rootFile]);
    const after = downloadsSnapshot([rootFile, folderFile]);
    expect(hasDownloadsChanged(before, after)).toBe(true);
  });

  test('change quand un fichier disparaît de la racine', () => {
    const before = downloadsSnapshot([rootFile, folderFile]);
    const after = downloadsSnapshot([folderFile]);
    expect(hasDownloadsChanged(before, after)).toBe(true);
  });

  test('change quand le fichier n’existe plus sur le disque', () => {
    const before = downloadsSnapshot([folderFile]);
    const after = downloadsSnapshot([{ ...folderFile, exists: false }]);
    expect(hasDownloadsChanged(before, after)).toBe(true);
  });

  test('est stable si l’ordre des fichiers change seulement', () => {
    const a = downloadsSnapshot([rootFile, folderFile]);
    const b = downloadsSnapshot([folderFile, rootFile]);
    expect(hasDownloadsChanged(a, b)).toBe(false);
  });
});

describe('isRelevantDownloadDelta', () => {
  test('ignore la progression bytesReceived (trop bruyant)', () => {
    expect(isRelevantDownloadDelta({ bytesReceived: { current: 50 } })).toBe(false);
  });

  test('réagit à un changement de chemin (racine ou dossier)', () => {
    expect(
      isRelevantDownloadDelta({
        filename: { current: 'Images/photo.jpg' },
      }),
    ).toBe(true);
  });

  test('réagit à la fin, à la suppression disque et à la taille finale', () => {
    expect(isRelevantDownloadDelta({ state: { current: 'complete' } })).toBe(true);
    expect(isRelevantDownloadDelta({ exists: { current: false } })).toBe(true);
    expect(isRelevantDownloadDelta({ fileSize: { current: 2048 } })).toBe(true);
    expect(isRelevantDownloadDelta({ endTime: { current: '2026-01-01' } })).toBe(true);
  });
});
