# Third-Party Notices

## Geist

Copyright (c) 2023 Vercel, in collaboration with basement.studio.

Geist is distributed under the SIL Open Font License 1.1. The complete license is included at `src/assets/fonts/Geist-LICENSE.txt`.

This project includes or integrates with third-party open-source software. Package versions are resolved by `package-lock.json` and `installer/package-lock.json`.

## Runtime And Application Dependencies

- Electron: desktop application shell.
- React: renderer UI framework.
- React DOM: renderer DOM integration.
- Vite: frontend development and production build tooling.
- SQLite: local relational storage engine.
- better-sqlite3: native SQLite binding used by Sawa derived storage and Core v2 storage.
- PDF.js / `pdfjs-dist`: PDF rendering and extraction support.
- TanStack Virtual / `@tanstack/react-virtual`: virtualized lists and grids.
- dnd-kit / `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`: drag and drop interactions.
- lucide-react: icon set.
- react-pro-sidebar: sidebar primitives.
- chokidar: filesystem watching.
- fast-xml-parser: XML parsing, including ComicInfo-related flows.
- yauzl: ZIP/CBZ archive reading support.

## Build And Installer Dependencies

- Electron Builder: Windows package generation.
- 7zip-bin: archive tooling used by installer build flows.
- sudo-prompt: elevation helper for installer flows when needed.
- check-disk-space: installer disk-space checks.
- concurrently, cross-env and wait-on: development scripts.

## Optional / Runtime Integrations

- Suwayomi Server: optional/local runtime for Sources web compatibility.
- Tachiyomi/Mihon ecosystem: compatibility inspiration for source-extension style workflows.

## Product And UX Inspiration

- Kavita by Kareadita: inspiration for library modeling, series/chapter presentation and reader ergonomics.

Kavita is credited as inspiration only. Sawa does not copy Kavita source code, HTML, CSS, assets or bundled implementation. The Kavita-like UI in Sawa is reimplemented in React/CSS within this project.

## Notice Maintenance

When dependencies are added, removed or updated, update this file and the README credits section. License obligations should be checked from the dependency manifests before release.
