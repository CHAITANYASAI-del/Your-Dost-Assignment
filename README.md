# YourDOST · Sr Product Designer assignment

Case study, working prototype and design rationale for the YourDOST assignment.

| Path | What it is |
|---|---|
| `index.html` | The case study (opens first) |
| `design.html` | The working prototype: **Task 1** My Accounts Today (web) and **Task 2** your Journey (iOS) |
| `doc.html` | Full design rationale |
| `track.js` | Anonymous reading analytics (sections, rows, scroll depth, clicks, engaged time) |
| `api/hit.js`, `api/visits.js` | Vercel functions that store and serve analytics (Vercel Blob) |
| `track/` | Built private dashboard at `/track` (password + Touch ID) |
| `stats-app/` | Dashboard source (React + Vite). `pnpm install && pnpm build` writes to `track/` |
| `scripts/build-manifest.py` | Tags every trackable block in `index.html` and writes `track-manifest.json` |

## Analytics
No cookies, no IP addresses stored. Country and city come from Vercel's edge headers. Add `?me` to the URL once per browser to exclude your own visits (`?notme` undoes it). The dashboard at `/track` is locked behind a password (checked on the server) with optional Touch ID. Requires env vars `STATS_KEY` (signs the session), `STATS_PASSWORD` and `BLOB_READ_WRITE_TOKEN`.

After editing `index.html`, run `python3 scripts/build-manifest.py` so the dashboard knows about any new blocks.
