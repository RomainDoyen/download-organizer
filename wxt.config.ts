import { existsSync } from 'node:fs';
import { defineConfig } from 'wxt';

/**
 * Binaire Chromium pour l’auto-lancement en dev (web-ext).
 * Évite les wrappers Flatpak/Snap si le CDP échoue.
 */
function resolveChromiumBinary(): string | undefined {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  return candidates.find((p) => existsSync(p));
}

const chromiumBinary = resolveChromiumBinary();

export default defineConfig({
  suppressWarnings: {
    firefoxDataCollection: true,
  },
  manifest: ({ browser }) => ({
    name: 'Download Organization',
    description: 'Classez automatiquement vos téléchargements par type de fichier.',
    permissions:
      browser === 'firefox'
        ? ['downloads']
        : ['downloads', 'downloads.shelf'],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'Download Organization',
    },
  }),
  webExt: chromiumBinary
    ? {
        binaries: {
          chrome: chromiumBinary,
          edge: chromiumBinary,
        },
      }
    : {
        disabled: true,
      },
});
