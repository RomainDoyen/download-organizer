import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { defineConfig } from 'wxt';

/** Dossier réellement chargé par Chrome (sans le suffixe -staging). */
let windowsLockedOutDir: string | undefined;

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
        ? ['downloads', 'storage', 'sidePanel', 'alarms']
        : ['downloads', 'downloads.open', 'downloads.shelf', 'storage', 'sidePanel', 'alarms'],
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
  hooks: {
    /**
     * Sous Windows, Chrome verrouille `.output/chrome-mv3` quand l'extension
     * est chargée en non empaquetée. WXT tente un rmdir et échoue (EBUSY).
     * On compile dans un dossier -staging, puis on écrase les fichiers en place.
     */
    'build:before'(wxt) {
      if (process.platform !== 'win32') return;
      const current = wxt.config.outDir;
      if (basename(current).endsWith('-staging')) return;
      windowsLockedOutDir = current;
      wxt.config.outDir = join(dirname(current), `${basename(current)}-staging`);
    },
    'build:done'(wxt) {
      if (!windowsLockedOutDir) return;
      const staging = wxt.config.outDir;
      const dest = windowsLockedOutDir;
      mkdirSync(dest, { recursive: true });
      try {
        cpSync(staging, dest, { recursive: true, force: true });
        wxt.logger.success(`Build copié vers ${dest}. Rechargez l'extension dans chrome://extensions.`);
      } catch (error) {
        wxt.logger.error(
          `Impossible d'écraser ${dest} (fichiers encore verrouillés). Fermez l'extension ou Chrome, puis relancez npm run build.`,
          error,
        );
        throw error;
      }
    },
  },
});
