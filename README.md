# Download Organization

Extension navigateur qui classe automatiquement les fichiers téléchargés dans des sous-dossiers du répertoire de téléchargement par défaut (Images, Vidéos, Audios, Documents, Autres), selon le type MIME et l’extension.

Compatible **Chrome**, **Edge** et **Firefox** (builds distincts via [WXT](https://wxt.dev)).

**Logo** : déposez votre `logo.png` (carré recommandé, ex. 128×128) dans [`public/logo.png`](./public/logo.png) pour l’extension (barre d’outils, popup, manifeste) et une copie dans [`docs/assets/logo.png`](./docs/assets/logo.png) pour le site de documentation.

## Prérequis

- [Node.js](https://nodejs.org/) 18+ (recommandé : LTS)

## Développement

```bash
npm install
npm run dev
```

Chargez le dossier généré (voir la sortie du terminal, en général `.output/chrome-mv3`) via « Charger l’extension non empaquetée » dans `chrome://extensions` (ou équivalent Edge / Firefox).

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

## Documentation (site statique)

Une documentation utilisateur en HTML/CSS/JS se trouve dans le dossier [`docs/`](./docs/). Ouvrez `docs/index.html` dans le navigateur ou servez le dossier avec n’importe quel serveur HTTP statique.

## Licence

Voir le dépôt pour les conditions d’utilisation.
