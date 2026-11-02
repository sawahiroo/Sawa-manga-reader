# Todo checkpoint

## Active slice

Cloture de validation et preuves de livraison locale.

## Todo

- [x] Selection Sawa/Coffre: carte canonique public+prive, intentions centralisees, cases et clavier.
- [x] Registre de fournisseurs, famille IMHentai/HentaiEra, consentement et protections.
- [x] Stockage/session v5 et contrats IPC legers.
- [x] Atelier virtualise, analyse/import/reprise, inspecteur et undo.
- [x] Parametres fournisseurs, cache public/prive et canari manuel desactive.
- [x] Suite E2E complete, benchmarks, paquet et installateur 4.2.0.

## Evidence

- 40 tests cibles passes apres ajout des migrations de references.
- 14 tests contrats/migration/fournisseurs passes apres la migration v5.
- E2E Coffre 500/320 privees passe en 7,3 s, y compris clic, case, clavier et plage virtuelle.
- E2E Atelier 500 lignes passe en 8,1 s; ouverture mesuree sous 1 s et moins de 40 lignes montees.
- Build Vite production passe (1 724 modules).
- Canari reseau manuel confirme desactive par defaut.
- Suite Vitest finale: 360/360.
- Suite E2E fonctionnelle: 15/15; smoke paquet+assistant: 2/2.
- Performances: froid p95 1 983 ms, chaud p95 1 913 ms, mutation 1 ms, recherche 13 ms, selection 56 ms, Coffre 17 ms.
- Installateur final: 173 272 833 octets, versions fichier/produit 4.2.0, SHA-256 `AA5683CA62366C5195A515EB664E082C99ECB872D77B0E348EAC10E3751FC5DC`, `NotSigned`.

## Resume state

Travail termine sans commit ni publication. L installateur est dans `release-installer/Sawa-Setup-4.2.0.exe`.

## Drift check

- Intent: aligne.
- Compatibilite: Sawa prioritaire, Kavita conserve recherche/selection et smoke.
- Fallback adulte: strictement opt-in, aucun contournement, cache prive purgable.
- Decision: done.
