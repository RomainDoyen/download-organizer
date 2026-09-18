import './style.css';
import { browser } from 'wxt/browser';
import {
  isSortingEnabled,
  setSortingEnabled,
  syncActionBadge,
} from '@/lib/sorting-settings';

const input = document.querySelector<HTMLInputElement>('#sort-enabled');
const detailEl = document.getElementById('status-detail');
const detailSrEl = document.getElementById('status-detail-sr');
const labelEl = document.getElementById('status-label');
const bannerEl = document.getElementById('status-banner');

const COPY = {
  on: {
    label: 'Classement automatique — activé',
    detail:
      'Chaque nouveau fichier est placé dans un sous-dossier (Images, Vidéos, Audios, Documents ou Autres) selon son type.',
  },
  off: {
    label: 'Classement automatique — désactivé',
    detail:
      'Les téléchargements se comportent comme d’habitude : un seul dossier, sans sous-dossiers imposés par l’extension.',
  },
} as const;

function applySortState(enabled: boolean): void {
  if (!input) return;
  input.checked = enabled;
  document.documentElement.dataset.sortState = enabled ? 'on' : 'off';

  const copy = enabled ? COPY.on : COPY.off;
  if (labelEl) labelEl.textContent = copy.label;
  if (detailEl) detailEl.textContent = copy.detail;
  if (detailSrEl) detailSrEl.textContent = copy.detail;
  if (bannerEl) bannerEl.setAttribute('aria-label', copy.label + '. ' + copy.detail);
}

async function init(): Promise<void> {
  if (!input) return;
  applySortState(await isSortingEnabled());

  input.addEventListener('change', async () => {
    const enabled = input.checked;
    await setSortingEnabled(enabled);
    syncActionBadge(enabled);
    applySortState(enabled);
  });

  const openBtn = document.getElementById('open-organizer');
  openBtn?.addEventListener('click', async () => {
    try {
      if (import.meta.env.FIREFOX) {
        await browser.sidebarAction.open();
        return;
      }
      const win = await browser.windows.getCurrent();
      if (win.id == null) return;
      await browser.sidePanel.open({ windowId: win.id });
    } catch (err) {
      console.error('[organizer] Impossible d’ouvrir le panneau', err);
    }
  });

  const grantBtn = document.getElementById('grant-folder');
  grantBtn?.addEventListener('click', async () => {
    try {
      await browser.tabs.create({
        url: browser.runtime.getURL('/folder-access.html'),
        active: true,
      });
    } catch (err) {
      console.error('[organizer] Impossible d’ouvrir la page d’autorisation', err);
    }
  });
}

void init();
