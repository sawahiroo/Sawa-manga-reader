# Sawa 4.2 - Selection du Coffre, Atelier de masse et nouvelles sources

## Requested outcome

Livrer localement Sawa 4.2.0 avec une selection multiple fiable dans l'interface Sawa et le Coffre, un Atelier utilisable sur 500 oeuvres, et des fournisseurs IMHentai/HentaiEra limites aux metadonnees et couvertures.

## Scope

- Controleur de selection canonique public + prive, intentions de clic, clavier et barre d'actions.
- Atelier virtualise, etats persistants, analyse/reprise/annulation/import par lot et IPC legers.
- Registre de fournisseurs, famille IMHentai, consentement HTML explicite, throttling et arret sur protection.
- Stockage/session v5, tests, paquet et installateur 4.2.0.

## Non-goals

- Aucun catalogue de lecture ou telechargement de pages depuis les fournisseurs adultes.
- Aucun contournement Cloudflare, CAPTCHA, authentification ou cookies navigateur.
- Aucun commit, push ou publication.

## Baseline read set

- Plan utilisateur Sawa 4.2 dans la tache courante.
- `src/App.jsx`, `src/utils/selectionSessions.js`, `src/components/MangaCard.jsx`, `src/components/VirtualMangaGrid.jsx`, `src/components/VaultView.jsx`.
- `src/components/MetadataWorkbenchView.jsx`, `electron/main.cjs`, `electron/preload.cjs`, `electron/services/storage.cjs`.
- Tests unitaires/E2E 4.1 et contrats de performance existants.

## Baseline usage

- Etat Git initial: HEAD `a7ea6f8d6e49e7235862101f3e251f129c1bd42c`, branche `codex/sawa-performance-stability`, amont synchronise, arbre propre.
- TanStack Virtual: cle stable via `getItemKey`, conteneur relatif et lignes absolument positionnees; mesure fixe choisie pour eviter les recalculs sur 500 lignes.
- Selection Coffre: le nettoyage actuel ne reconnait que `library.allMangas`, donc annule les identifiants prives juste apres le clic.

## Impact statement

Le changement traverse renderer, preload, main, stockage persistant, reseau et packaging. Les invariants critiques sont: donnees privees jamais exposees quand le Coffre est verrouille, pas de payload complet par ligne, pas d'ecriture dans les dossiers manga pour les couvertures distantes, et aucune automatisation ambigue.

## Interface direction

- Domain: table de tri, catalogue, fiche d'autorite, provenance, confiance, lot, validation.
- Color world: papier sombre, encre, laiton discret, vert validation, ambre verification, rouge erreur.
- Signature: rail de confiance continu sur chaque ligne, lie a la provenance et aux champs proposes.
- Defaults rejetes: cartes generiques -> lignes de catalogage; grille de resultats -> inspecteur compare; animations decoratives -> feedback immediat sans mouvement repete.
- Intent: l'utilisateur traite des centaines d'oeuvres; le focal est la prochaine decision sure, dans une interface dense, calme et lisible.
- Hierarchy: progression/commandes de lot, puis rail de confiance, puis inspecteur.
- Depth: bordures et changements de surface existants; aucune nouvelle ombre lourde.
- Typography: famille existante; poids/couleur avant augmentation de taille.
- Spacing: grille 4 px, lignes compactes, zones tactiles de 40 px minimum.

## Stop conditions

- Done: criteres fonctionnels verifies, suite de tests pertinente verte, build et installateur produits et inspectes.
- Needs verification: fonctionnalite implementee mais validation empaquetee ou reseau manuel non concluante.
- Blocked: dependance externe indispensable indisponible sans alternative autorisee.
- Scope exceeded: toute demande de contournement de protection ou publication automatique.
