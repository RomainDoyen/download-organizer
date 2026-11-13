import './style.css';
import { browser } from 'wxt/browser';
import {
  chromiumDirectoryBlockHint,
  chromiumFolderFlagHint,
  classicFolderReadHint,
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
const classicBtn = document.getElementById('pick-folder-classic') as HTMLButtonElement;
const introEl = document.getElementById('intro')!;
const statusEl = document.getElementById('status')!;
const helpEl = document.getElementById('browser-help')!;

const helpParts: string[] = [];
if (isFolderAccessSupported()) helpParts.push(classicFolderReadHint());
if (needsChromiumFolderFlag()) helpParts.push(chromiumFolderFlagHint());
if (!isFolderAccessSupported()) {
  introEl.innerHTML =
    'Choisissez un dossier, par exemple <strong>Téléchargements</strong>. Vous pouvez en ajouter d’autres ensuite.';
  pickBtn.textContent = 'Ajouter un dossier';
  classicBtn.hidden = true;
}
if (helpParts.length > 0) {
  helpEl.hidden = false;
  helpEl.textContent = helpParts.join(' ');
}

async function existingFolderNames(): Promise<string[]> {
  const [handles, groups] = await Promise.all([loadDirHandles(), loadSessionFolderGroups()]);
  return [...handles.map((handle) => handle.name), ...groups.map((group) => group.name)];
}

async function markLinked(): Promise<void> {
  await browser.storage.local.set({ [DOWNLOADS_FOLDER_LINKED_KEY]: Date.now() });
}

async function saveClassicFolder(files: File[], button: HTMLButtonElement, nextLabel: string): Promise<void> {
  if (files.length === 0) {
    statusEl.textContent = 'Aucun fichier reçu. Avec ce sélecteur, Téléchargements est accepté.';
    return;
  }
  try {
    const name = uniqueDisplayName(folderNameFromFiles(files), await existingFolderNames());
    const groups = await addSessionFolderGroup({ name, files });
    await markLinked();
    statusEl.textContent = `« ${name} » est lu jusqu’à la fermeture du navigateur (${files.length} fichiers, ${groups.length} dossier${groups.length > 1 ? 's' : ''}).`;
    button.textContent = nextLabel;
  } catch {
    statusEl.textContent = 'Dossier trop volumineux à mémoriser. Réessayez depuis le panneau latéral.';
  }
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
        statusEl.textContent = chromiumDirectoryBlockHint();
        return;
      }
      console.warn('[organizer] Sélecteur avancé indisponible', err);
    }
  }

  if (!isDirectoryInputSupported()) {
    statusEl.textContent = chromiumFolderFlagHint();
    return;
  }

  await saveClassicFolder(await pickDownloadsFolderViaInput(), pickBtn, 'Ajouter un autre dossier');
}

pickBtn.addEventListener('click', () => {
  void pickFolder();
});

classicBtn.addEventListener('click', () => {
  void pickDownloadsFolderViaInput().then((files) => saveClassicFolder(files, classicBtn, 'Lire un autre dossier'));
});
