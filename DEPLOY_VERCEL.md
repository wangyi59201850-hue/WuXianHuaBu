# Vercel Deploy

1. Push this folder to a Git repository.
2. Import the repository at `https://vercel.com/new`.
3. In Vercel project settings, add the environment variables from `.env.example`.
4. Keep the framework preset as `Next.js`.
5. Build command: `npm run build`
6. Install command: `npm install`

## Notes

- This cloud build keeps the canvas app and external image/video providers.
- Local `dreamina` CLI, local cache directory management, and desktop-only diagnostics are disabled in this copy.
- New prompt nodes default to cloud-safe providers.
