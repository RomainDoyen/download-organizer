import './style.css';
import { browser } from 'wxt/browser';
import {
  chromiumFolderFlagHint,
  folderNameFromFiles,
  isDirectoryInputSupported,
  isFolderAccessSupported,
  needsChromiumFolderFlag,
  pickDownloadsFolder,
  pickDownloadsFolderViaInput,
  queryFolderPermission,
  requestFolderPermission,
  uniqueDisplayName,
} from '@/lib/local-folder';
import {
  DOWNLOADS_FOLDER_LINKED_KEY,
  addDirHandle,
  addSessionFolderGroup,
  loadDirHandles,
  loadSessionFolderGroups,
} from '@/lib/folder-handle-store';

const pickBtn = document.getElementById('pick-folder') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const helpEl = document.getElementById('browser-help')!;

if (needsChromiumFolderFlag()) {
  helpEl.hidden = false;
  helpEl.textContent = chromiumFolderFlagHint();
}

async function existingFolderNames(): Promise<string[]> {
  const [handles, groups] = await Promise.all([loadDirHandles(), loadSessionFolderGroups()]);
  return [...handles.map((handle) => handle.name), ...groups.map((group) => group.name)];
}

async function markLinked(): Promise<void> {
  await browser.storage.local.set({ [DOWNLOADS_FOLDER_LINKED_KEY]: Date.now() });
}

async function pickFolder(): Promise<void> {
  if (isFolderAccessSupported()) {
    try {
      const handle = await pickDownloadsFolder();
      let permission = await queryFolderPermission(handle);
      if (permission !== 'granted') {
        permission = await requestFolderPermission(handle);
      }
      if (permission !== 'granted') {
        statusEl.textContent = 'Accès refusé. Réessayez et acceptez la permission.';
        return;
      }
      const before = (await loadDirHandles()).length;
      const next = await addDirHandle(handle);
      await markLinked();
      if (next.length === before) {
        statusEl.textContent = `« ${handle.name} » est déjà connecté. Ajoutez un autre dossier ou fermez cet onglet.`;
      } else {
        statusEl.textContent = `« ${handle.name} » a été ajouté (${next.length} dossier${next.length > 1 ? 's' : ''}). Vous pouvez en connecter d’autres ou fermer cet onglet.`;
      }
      pickBtn.textContent = 'Ajouter un autre dossier';
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        statusEl.textContent = 'Aucun dossier choisi. Cliquez à nouveau pour en ajouter un.';
        return;
      }
      console.warn('[organizer] Sélecteur avancé indisponible', err);
    }
  }

  if (!isDirectoryInputSupported()) {
    statusEl.textContent = chromiumFolderFlagHint();
    return;
  }

  const files = await pickDownloadsFolderViaInput();
  if (files.length === 0) {
    statusEl.textContent = 'Aucun fichier reçu. Choisissez un dossier (souvent Téléchargements).';
    return;
  }
  try {
    const name = uniqueDisplayName(folderNameFromFiles(files), await existingFolderNames());
    const groups = await addSessionFolderGroup({ name, files });
    await markLinked();
    statusEl.textContent = `« ${name} » a été ajouté (${files.length} fichiers, ${groups.length} dossier${groups.length > 1 ? 's' : ''}). Vous pouvez en connecter d’autres ou fermer cet onglet.`;
    pickBtn.textContent = 'Ajouter un autre dossier';
  } catch {
    statusEl.textContent = 'Dossier trop volumineux à mémoriser. Utilisez le bouton dans le panneau latéral.';
  }
}

pickBtn.addEventListener('click', () => {
  void pickFolder();
});
