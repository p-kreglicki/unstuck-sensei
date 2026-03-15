# Unstuck Sensei

Tauri v2 desktop foundation for Unstuck Sensei, an AI coaching app that helps solo founders break stuck work into small, actionable steps.

## Stack

- Tauri v2
- React 19
- TypeScript
- Vite
- Tailwind CSS v4
- Supabase (planned auth + database backend)

## Commands

```bash
npm install
npm run build
npm run tauri build -- --debug --bundles app
cargo check --manifest-path src-tauri/Cargo.toml
```

## Current Scope

This repository currently includes:

- Desktop scaffold and Tauri app metadata
- Tray menu and hide-to-tray window behavior
- React Router shell with login, protected routes, and placeholder pages
- Supabase client wiring and a local SQL migration file for the planned schema

Manual follow-up is still required for:

- Supabase project creation and auth configuration
- Deep link callback validation
- Live auth testing against a real backend
- GUI verification of tray behavior in `tauri dev`
