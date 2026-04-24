# Download Organization

<p align="center">
  <img
    src="./public/logo.png"
    alt="Logo Download Organization"
    width="128"
    height="128"
    style="border-radius: 28px;"
  />
</p>

<p align="center">
  <strong>Extension navigateur</strong> — classement automatique des téléchargements<br />
  dans des sous-dossiers du répertoire par défaut (Images, Vidéos, Audios, Documents, Autres),<br />
  selon le type MIME et l’extension.
</p>

<p align="center">
  Compatible <strong>Chrome</strong>, <strong>Edge</strong> et <strong>Firefox</strong> (builds distincts via <a href="https://wxt.dev">WXT</a>).
</p>

## Documentation

**Tout est expliqué dans la documentation statique** du projet : fonctionnement, commandes de build, **marche à suivre pour installer l’extension dans chaque navigateur** une fois la build produite, développement et prise en charge des plateformes.

→ Ouvrez [`docs/index.html`](./docs/index.html) dans le navigateur ou servez le dossier [`docs/`](./docs/) avec n’importe quel serveur HTTP statique.

**Logo** : placez votre `logo.png` (carré recommandé, ex. 128×128) dans [`public/logo.png`](./public/logo.png) pour l’extension (barre d’outils, popup, manifeste) et une copie dans [`docs/assets/logo.png`](./docs/assets/logo.png) pour le site de documentation.

## Prérequis

- [Node.js](https://nodejs.org/) 18+ (recommandé : LTS)

## Développement

```bash
npm install
npm run dev
```

Chargez le dossier généré (voir la sortie du terminal, en général `.output/chrome-mv3`) via « Charger l’extension non empaquetée » dans `chrome://extensions` (ou équivalent Edge / Firefox). Pour le détail par navigateur, voir la [documentation](#documentation).

- `npm run dev:firefox` — prévisualisation Firefox  
- `npm run dev:edge` — prévisualisation Edge  

## Build

```bash
npm run build              # Chrome (MV3)
npm run build:edge         # Edge
npm run build:firefox      # Firefox
```

Les artefacts se trouvent sous `.output/<navigateur>/`.

## Archives pour les stores

```bash
npm run zip
npm run zip:edge
npm run zip:firefox
```

## Licence

Voir le dépôt pour les conditions d’utilisation.
