# Evidence bundle draft

## Selection Coffre

- Cause: nettoyage des selections compare a `library.allMangas` uniquement.
- Correction: identifiants normalises, ordre virtuel complet, carte canonique public+prive, intentions de clic centralisees.
- E2E: profil isole de 500 oeuvres dont 320 privees; clic, case native, clavier et plage apres scroll passent.

## Atelier et fournisseurs

- Table TanStack virtualisee de 500 lignes avec rail de confiance et inspecteur.
- Politique automatique testee: identifiant externe, ou titre exact avec signal concordant, seuil 0,96 et marge 0,15.
- Fixtures figees IMHentai/HentaiEra: parsing, deduplication, API-first, fallback miroir, 403/CAPTCHA et 429.
- Cache public sept jours/LRU 5 000; cache Coffre en memoire et purge au verrouillage/fermeture.

## Validation intermediaire

- `npm run build:web`: passe.
- Tests cibles: 40/40 puis 14/14.
- `npm run test:metadata-canary`: passe sans reseau, canari desactive par defaut.
- Playwright Atelier 500: passe, ouverture sous 1 s, moins de 40 lignes DOM.
- Playwright Coffre: passe apres reconstruction du bundle.

## Validation finale

- `npm test -- --run`: 100 fichiers, 360 tests passes.
- Playwright fonctionnel: 15/15 passes, Sawa prioritaire et smoke Kavita inclus.
- Playwright performances:
  - demarrage froid p95: 1 983 ms;
  - demarrage chaud p95: 1 913 ms;
  - mutations p95: 1 ms;
  - suggestions p95: 13 ms;
  - entree selection p95: 56 ms;
  - selection Coffre 500 oeuvres p95: 17 ms;
  - aucun evenement `unresponsive` ni long task controlee >50 ms.
- `pack:dir`: passe; smoke de l executable sur profil v5 isole passe.
- `dist:installer`: passe apres correction des anciennes mentions 4.0.0.
- Smoke de l assistant empaquete: passe et affiche 4.2.0.
- Smoke du wrapper SFX final: extrait et lance `installer-ui.exe`, puis nettoie son repertoire temporaire.
- Artefact: `release-installer/Sawa-Setup-4.2.0.exe`.
- Taille: 173 272 833 octets.
- SHA-256: `AA5683CA62366C5195A515EB664E082C99ECB872D77B0E348EAC10E3751FC5DC`.
- Versions fichier/produit: 4.2.0 / 4.2.0.
- Signature Authenticode: `NotSigned`.

## Limites

- Le canari reseau adulte est volontairement desactive par defaut et n a pas ete lance contre les sites reels; les tests utilisent des fixtures figees.
- Le JAR Suwayomi optionnel est absent de `.codex-cache/suwayomi/` pendant le packaging; electron-builder le signale sans faire echouer Sawa.
- Le wrapper NSIS personnalise n est pas reconnu comme archive par 7-Zip; son extraction/lancement a donc ete teste directement.
- Aucun commit, push, tag ou publication n a ete effectue.
