import { describe, expect, test } from 'vitest';
import {
  archiveRelativePath,
  canArchiveFromUrl,
  canPreviewFromUrl,
  escapeHtml,
  isUnderFolder,
  indicesInRange,
  keyToAction,
  shouldCancelBeforeArchive,
  shouldPreserveSuggestedFilename,
} from './organizer-logic';

describe('escapeHtml', () => {
  test('échappe les caractères HTML dans les attributs', () => {
    expect(escapeHtml('a&b<c>"d\'e')).toBe(
      'a&amp;b&lt;c&gt;&quot;d&#039;e',
    );
  });
});

describe('canPreviewFromUrl', () => {
  test('accepte les URLs http(s) vers un fichier média', () => {
    expect(canPreviewFromUrl('https://cdn.example/photo.jpg')).toBe(true);
    expect(canPreviewFromUrl('http://example/a.png')).toBe(true);
    expect(canPreviewFromUrl('https://cdn.shopify.com/s/files/1/foo.webp?v=1')).toBe(true);
  });

  test('refuse les URLs illisibles depuis le panneau (blob, file, data)', () => {
    expect(canPreviewFromUrl('blob:https://site/uuid')).toBe(false);
    expect(canPreviewFromUrl('file:///C:/Users/x/Downloads/a.jpg')).toBe(false);
    expect(canPreviewFromUrl('data:image/png;base64,abc')).toBe(false);
    expect(canPreviewFromUrl('')).toBe(false);
  });

  test('refuse les pages HTML (sinon Chrome charge leurs scripts dans le panneau)', () => {
    expect(canPreviewFromUrl('https://tie-house.com/products/une-cravate')).toBe(false);
    expect(canPreviewFromUrl('https://tie-house.com/cdn/shop/t/2/assets/theme.js')).toBe(
      false,
    );
    expect(canPreviewFromUrl('https://cdn.example/page.html')).toBe(false);
    expect(canPreviewFromUrl('https://cdn.example/photo.jpg', 'text/html')).toBe(false);
  });
});

describe('canArchiveFromUrl', () => {
  test('permet de relancer un téléchargement http(s)', () => {
    expect(canArchiveFromUrl('https://cdn.example/photo.jpg')).toBe(true);
  });

  test('refuse blob/file/data — le fichier local ne peut pas être recollé via l’API downloads', () => {
    expect(canArchiveFromUrl('blob:https://site/uuid')).toBe(false);
    expect(canArchiveFromUrl('file:///C:/Users/x/a.jpg')).toBe(false);
  });
});

describe('shouldCancelBeforeArchive', () => {
  test('n’annule pas un téléchargement déjà terminé', () => {
    expect(shouldCancelBeforeArchive('complete')).toBe(false);
  });

  test('annule seulement s’il est encore en cours', () => {
    expect(shouldCancelBeforeArchive('in_progress')).toBe(true);
  });
});

describe('archiveRelativePath', () => {
  test('construit un chemin relatif au dossier Téléchargements', () => {
    expect(archiveRelativePath('Archives', 'photo.jpg')).toBe('Archives/photo.jpg');
  });

  test('nettoie les slashes du dossier', () => {
    expect(archiveRelativePath('/Archives/', 'a.png')).toBe('Archives/a.png');
  });
});

describe('isUnderFolder', () => {
  test('détecte un fichier déjà dans le dossier d’archive', () => {
    expect(isUnderFolder('C:\\Users\\x\\Downloads\\Archives\\photo.jpg', 'Archives')).toBe(
      true,
    );
    expect(isUnderFolder('/home/x/Downloads/Images/photo.jpg', 'Archives')).toBe(false);
  });
});

describe('shouldPreserveSuggestedFilename', () => {
  test('laisse passer les téléchargements lancés par l’extension (archivage)', () => {
    expect(
      shouldPreserveSuggestedFilename({
        byExtensionId: 'abcdefgh',
        filename: 'Archives/photo.jpg',
        archiveFolder: 'Archives',
      }),
    ).toBe(true);
  });

  test('ne repréfixe pas un fichier déjà classé', () => {
    expect(
      shouldPreserveSuggestedFilename({
        filename: 'Images/photo.jpg',
        archiveFolder: 'Archives',
      }),
    ).toBe(true);
  });

  test('préserve le dossier d’archive même sans byExtensionId', () => {
    expect(
      shouldPreserveSuggestedFilename({
        filename: 'Archives/photo.jpg',
        archiveFolder: 'Archives',
      }),
    ).toBe(true);
  });

  test('classe un nouveau fichier hors dossiers connus', () => {
    expect(
      shouldPreserveSuggestedFilename({
        filename: 'photo.jpg',
        archiveFolder: 'Archives',
      }),
    ).toBe(false);
  });
});

describe('keyToAction', () => {
  test('← supprime, → archive, ↑ ouvre quand un fichier est sélectionné', () => {
    expect(keyToAction('ArrowLeft', true)).toEqual({ type: 'delete' });
    expect(keyToAction('ArrowRight', true)).toEqual({ type: 'archive' });
    expect(keyToAction('ArrowUp', true)).toEqual({ type: 'open' });
  });

  test('↓ passe au suivant (ou au premier s’il n’y a pas de sélection)', () => {
    expect(keyToAction('ArrowDown', true)).toEqual({ type: 'next' });
    expect(keyToAction('ArrowDown', false)).toEqual({ type: 'select-first' });
  });

  test('↑ sans sélection sélectionne le premier fichier', () => {
    expect(keyToAction('ArrowUp', false)).toEqual({ type: 'select-first' });
  });

  test('ignore les flèches gauche/droite sans sélection', () => {
    expect(keyToAction('ArrowLeft', false)).toBeNull();
    expect(keyToAction('ArrowRight', false)).toBeNull();
  });
});

describe('indicesInRange', () => {
  test('inclut les bornes dans les deux sens', () => {
    expect(indicesInRange(2, 5)).toEqual([2, 3, 4, 5]);
    expect(indicesInRange(5, 2)).toEqual([2, 3, 4, 5]);
  });
});
