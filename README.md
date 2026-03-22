# firefox-addon-sync-pinned-tabs

A small Firefox add-on that syncs pinned tabs across devices via a self-hosted
FastAPI backend.

---

## Repository layout

```
.
├── extension/          Firefox WebExtension (Manifest V2)
│   ├── manifest.json
│   ├── background.js   Sync logic (install → register, periodic sync, conflict resolution)
│   ├── icons/
│   └── popup/          Browser-action popup UI
└── server/             Python FastAPI server
    ├── main.py         API routes
    ├── database.py     SQLAlchemy + SQLite models
    ├── models.py       Pydantic schemas
    ├── requirements.txt
    └── Dockerfile
```

---

## Extension

### How it works

1. **First install** – the extension registers a new profile with the server
   and receives a UUID.  The UUID is stored in `browser.storage.local`.
2. **Subsequent installs** – supply the same UUID via the popup (or let it
   auto-register a new one).
3. **Sync algorithm** – on install, browser start, every 15 minutes, and
   whenever a tab is pinned/unpinned:
   - Fetch remote tabs + `last_modified` from server.
   - If local `lastModified` > remote → push local tabs to server.
   - Otherwise → apply remote tabs locally (open missing, close extra).

### Building a release zip

```bash
cd extension
zip -r ../sync-pinned-tabs-extension.zip . --exclude "*.git*"
```

This is also done automatically by the **Build and Release Extension** GitHub
Actions workflow on every tag / release.

---

## Server

### Running locally

```bash
cd server
pip install -r requirements.txt
uvicorn main:app --reload
```

The SQLite database is stored in `pinned_tabs.db` (configurable via the
`DATABASE_URL` environment variable).

### Docker

```bash
docker build -t sync-pinned-tabs-server ./server
docker run -p 8000:8000 sync-pinned-tabs-server
```

The Docker image is built and pushed to **GitHub Container Registry** on every
commit to `main` and on every tag by the **Build and Push Docker Image**
workflow.

### API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/profiles` | Register a new profile → `{id, created_at}` |
| `GET`  | `/profiles/{id}/tabs` | Fetch pinned tabs (cached 60 s) |
| `PUT`  | `/profiles/{id}/tabs` | Replace pinned tabs |
| `GET`  | `/health` | Health check |

---

## CI / CD

| Workflow | Trigger | Action |
|----------|---------|--------|
| **Build and Push Docker Image** | push to `main` or any `v*` tag | Build & push server image to GHCR |
| **Build and Release Extension** | `v*` tag or release | Zip extension, upload as artifact & attach to release |
