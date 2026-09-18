import { describe, expect, test } from 'vitest';
import {
  chromePathMatchesRelative,
  folderRecordKey,
  fsStableId,
  mergeUncoveredFsItems,
  relativePathFromWebkitPath,
  shouldSkipDirName,
  shouldSkipFileName,
  shouldSkipLocalRelativePath,
  uniqueDisplayName,
} from './local-folder';

describe('chromePathMatchesRelative', () => {
  test('relie un fichier Chrome à la racine Téléchargements', () => {
    expect(
      chromePathMatchesRelative('C:\\Users\\x\\Downloads\\notes.txt', 'notes.txt'),
    ).toBe(true);
  });

  test('relie un fichier Chrome déjà dans un sous-dossier', () => {
    expect(
      chromePathMatchesRelative(
        'C:\\Users\\x\\Downloads\\Images\\photo.jpg',
        'Images/photo.jpg',
      ),
    ).toBe(true);
  });

  test('ne confond pas un nom qui se termine pareil', () => {
    expect(
      chromePathMatchesRelative('C:\\Users\\x\\Downloads\\oldphoto.jpg', 'photo.jpg'),
    ).toBe(false);
  });
});

describe('mergeUncoveredFsItems', () => {
  test('ajoute seulement les fichiers absents de l’historique Chrome', () => {
    const extra = mergeUncoveredFsItems(
      ['C:\\Users\\x\\Downloads\\Images\\a.jpg', 'C:\\Users\\x\\Downloads\\b.pdf'],
      [
        { relativePath: 'Images/a.jpg', name: 'a.jpg' },
        { relativePath: 'copié-main.docx', name: 'copié-main.docx' },
        { relativePath: 'b.pdf', name: 'b.pdf' },
      ],
    );
    expect(extra.map((f) => f.relativePath)).toEqual(['copié-main.docx']);
  });
});

describe('fsStableId', () => {
  test('est négatif et stable', () => {
    const a = fsStableId('Images/photo.jpg');
    const b = fsStableId('Images/photo.jpg');
    expect(a).toBe(b);
    expect(a).toBeLessThan(0);
  });

  test('différencie deux chemins', () => {
    expect(fsStableId('a.txt')).not.toBe(fsStableId('b.txt'));
  });

  test('différencie le même fichier dans deux dossiers connectés', () => {
    expect(fsStableId(folderRecordKey('Téléchargements', 'a.jpg'))).not.toBe(
      fsStableId(folderRecordKey('Bureau', 'a.jpg')),
    );
  });
});

describe('uniqueDisplayName', () => {
  test('ajoute un suffixe si le nom existe déjà', () => {
    expect(uniqueDisplayName('Downloads', [])).toBe('Downloads');
    expect(uniqueDisplayName('Downloads', ['Downloads'])).toBe('Downloads (2)');
    expect(uniqueDisplayName('Downloads', ['Downloads', 'Downloads (2)'])).toBe('Downloads (3)');
  });
});

describe('shouldSkipDirName', () => {
  test('ignore le dossier d’archive à la racine', () => {
    expect(shouldSkipDirName('Archives', 'Archives', 0)).toBe(true);
    expect(shouldSkipDirName('Images', 'Archives', 0)).toBe(false);
  });

  test('ignore les dossiers système', () => {
    expect(shouldSkipDirName('.git', 'Archives', 1)).toBe(true);
    expect(shouldSkipDirName('node_modules', 'Archives', 1)).toBe(true);
  });
});

describe('shouldSkipFileName', () => {
  test('ignore les fichiers de métadonnées Windows/macOS', () => {
    expect(shouldSkipFileName('Thumbs.db')).toBe(true);
    expect(shouldSkipFileName('notes.txt')).toBe(false);
  });
});

describe('relativePathFromWebkitPath', () => {
  test('retire le nom du dossier choisi (Téléchargements ou Downloads)', () => {
    expect(relativePathFromWebkitPath('Téléchargements/photo.jpg', 'photo.jpg')).toBe('photo.jpg');
    expect(relativePathFromWebkitPath('Downloads/Images/a.png', 'a.png')).toBe('Images/a.png');
  });

  test('garde le nom si le chemin n’a qu’un segment', () => {
    expect(relativePathFromWebkitPath('photo.jpg', 'photo.jpg')).toBe('photo.jpg');
  });
});

describe('shouldSkipLocalRelativePath', () => {
  test('ignore le dossier d’archive et les fichiers système', () => {
    expect(shouldSkipLocalRelativePath('Archives/x.pdf', 'Archives')).toBe(true);
    expect(shouldSkipLocalRelativePath('Images/Thumbs.db', 'Archives')).toBe(true);
    expect(shouldSkipLocalRelativePath('Images/photo.jpg', 'Archives')).toBe(false);
  });
});
