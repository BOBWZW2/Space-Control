# Space Control Sync Worker

This Cloudflare Worker keeps the GitHub token out of the browser. The frontend calls this worker first when saving the shared Space Control cache, and falls back to the old browser GitHub token path only if the worker is unavailable.

## Deploy

```powershell
cd sync-worker
npx wrangler secret put GITHUB_TOKEN
npx wrangler deploy
```

Use a GitHub token that can write to `BOBWZW2/Space-Control` contents. A fine-grained token should grant `Contents: Read and write` on that repository.

Default public URL expected by the frontend:

```text
https://space-control-sync.2119990716.workers.dev
```

## Endpoints

- `GET /api/health`
- `GET /api/cache`
- `POST /api/cache/record` with `{ "record": { ... } }`

The worker only reads and writes `data/space-control-cache.json`.
