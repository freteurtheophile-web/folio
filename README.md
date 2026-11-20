# Folio

Lire, annoter au stylet, signer et transformer vos PDF. Optimisé pour l'étude.
Tout fonctionne sur l'appareil : les documents ne sont jamais envoyés sur internet.

## Lancer Folio sur Windows

Double-cliquez sur **Folio.lnk** (ou lancez `tools\serve.ps1`). Folio s'ouvre dans sa propre fenêtre Edge.
Pour l'installer comme une application : menu ⋯ → Applications → Installer.

## Installer Folio sur Android (version en ligne)

La version en ligne est publiée par GitHub Pages (gratuit), à partir de ce dossier.

### Première mise en ligne

1. Créez un compte sur https://github.com (si besoin), puis un dépôt vide nommé `folio`
   (bouton **New repository**, sans README).
2. Dans ce dossier, ouvrez un terminal PowerShell et tapez (en remplaçant `VOTRE-NOM`) :
   ```
   git add -A
   git commit -m "Folio 1.0"
   git branch -M main
   git remote add origin https://github.com/VOTRE-NOM/folio.git
   git push -u origin main
   ```
3. Sur GitHub, dans le dépôt : **Settings → Pages → Source : GitHub Actions**.
4. Après une à deux minutes, Folio est disponible à l'adresse
   `https://VOTRE-NOM.github.io/folio/`.

### Sur le téléphone

Ouvrez cette adresse dans Chrome, puis menu ⋮ → **Ajouter à l'écran d'accueil** (ou **Installer l'application**).
Folio fonctionne ensuite hors ligne, comme une application.

### Mettre à jour

Après une modification : `git add -A`, `git commit -m "…"`, `git push`. La version en ligne se met à jour toute seule,
et les appareils reçoivent la nouvelle version à la prochaine ouverture.

## Tests

Avec Folio ouvert, dans la console du navigateur (F12) :

```js
const t = await import('/tests/selftest.js'); await t.run();
```

126 vérifications : stylets et pression, gomme, lasso, texte, notes, formes, signatures, pages,
enregistrement et réouverture, impression, tous les outils PDF, OCR, dictionnaire, traduction, mode étude.

## Contenu

- `js/` : l'application (lecteur, encre, annotations, outils, étude, dictionnaire…)
- `vendor/` : pdf.js (Mozilla, Apache 2.0) et pdf-lib (MIT)
- `icons/` : logo et icônes (`tools/make-icons.ps1` les régénère)
- `tools/serve.ps1` : petit serveur local pour Windows
