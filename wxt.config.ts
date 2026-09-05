import { existsSync } from 'node:fs';
import { defineConfig } from 'wxt';

/**
 * Binaire Chromium pour l'auto-lancement en dev (web-ext).
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
        ? ['downloads', 'storage', 'sidePanel']
        : ['downloads', 'downloads.open', 'downloads.shelf', 'storage', 'sidePanel'],
    host_permissions: ['<all_urls>'],
    icons: {
      16: 'logo.png',
      32: 'logo.png',
      48: 'logo.png',
      96: 'logo.png',
      128: 'logo.png',
    },
    action: {
      default_title: 'Download Organization',
      default_icon: {
        16: 'logo.png',
        32: 'logo.png',
        48: 'logo.png',
      },
    },
    side_panel: {
      default_path: 'sidepanel/index.html',
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
  vite: () => ({
    build: {
      modulePreload: false,
      rollupOptions: {
        output: {
          manualChunks: undefined,
        },
      },
    },
  }),
});
