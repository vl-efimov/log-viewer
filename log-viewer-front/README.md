# LuVo - log viewer (frontend)

This project was created as part of a 2026 diploma thesis at FIT CTU, Department of Software Engineering, by student Vladimir Efimov.

This is the client-side application for LuVo. It provides the UI and communicates with the backend API.

## Quick start

From the repository root:

```bash
cd log-viewer-front
npm install
npm run dev
```

Open the dev server URL printed by Vite (usually http://127.0.0.1:5173).

## Backend URL

The frontend reads the backend URL from `VITE_ANOMALY_API_URL` (or `VITE_BGL_API_URL` as a fallback) and defaults to `http://127.0.0.1:8001`.

## Scripts

- `npm run dev` - start the dev server
- `npm run build` - build production assets
- `npm run preview` - preview the production build
- `npm run lint` - run linting
