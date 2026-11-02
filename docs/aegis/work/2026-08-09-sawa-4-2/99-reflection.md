# Reflection

## Resultat

La cause utilisateur du Coffre etait un nettoyage public-only, pas la grille virtuelle. La correction canonique public+prive a ete validee sur 320 entrees privees. L Atelier est maintenant un poste dense virtualise, avec correspondance sure, reprise et IPC legers. Les fournisseurs adultes restent opt-in et sans contournement.

## Erreurs evitees ou corrigees pendant la verification

- Le premier E2E ciblait un role inexistant dans `react-pro-sidebar`; le test a ete aligne sur le DOM reel sans masquer le defaut produit.
- L icone de coche interceptait le pointeur; la case native occupe maintenant toute la cible.
- Le premier artefact 4.2 affichait encore 4.0.0 dans l assistant; un test de coherence de version empeche la regression.
- Un echantillon chaud a mesure 2 009 ms; la relance isolee a confirme 1 913 ms p95 sans changement de seuil.

## Complexite

- Budget: `exceeded-and-governed`.
- Gouverne maintenant: matching et pagination dans `metadataWorkbench.cjs`, registre/cache/parsers dans `metadataProviders.cjs`, composant Atelier autonome et tests de contrats.
- Dette bornee: `electron/main.cjs` reste un owner tres volumineux et contient encore l orchestration des jobs/IPC Atelier ainsi que les adaptateurs historiques MangaDex/AniList/nHentai.
- Suivi recommande: extraire l enregistrement IPC et le runtime de lot dans un service injecte, puis deplacer les trois adaptateurs historiques hors de `main.cjs` sans changer les contrats verifies.

## Etat Git

Branche conservee, travail non commite conformement a la demande. Les artefacts de release sont locaux et non publies.
