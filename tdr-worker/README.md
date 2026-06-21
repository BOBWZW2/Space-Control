# Space Control TDR Worker

This Cloudflare Worker is isolated from the workbook generator. It only signs in to Allegro, reads TDR data, and returns the existing TDR payload shape to the GitHub Pages frontend.

Endpoints:

- `GET /api/health`
- `POST /api/tdr`
- `POST /api/tdr/batch` (streaming NDJSON, one Allegro session per bound)
