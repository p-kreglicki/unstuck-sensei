# Unstuck Sensei

## Stack
- Tauri v2 desktop app (Rust + React/TypeScript)
- Vite + Tailwind CSS + React Router v7 (declarative mode)
- Supabase (Auth + Postgres + RLS)
- Claude Haiku 4.5 via Vercel proxy in later phases

## Conventions
- Frontend lives in `src/`
- Rust backend lives in `src-tauri/src/`
- Use `invoke()` from `@tauri-apps/api/core` for Rust commands
- Use `listen()` from `@tauri-apps/api/event` for Rust events
- All Supabase calls are direct from the desktop client
- Tokens are stored in the OS keychain via `tauri-plugin-secure-storage`
- `service_role` keys stay out of the desktop app

## Commands
- `npm install`
- `npm run tauri dev`
- `npm run tauri build`
