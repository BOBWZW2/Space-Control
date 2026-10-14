# Space Control TDR Worker

This Cloudflare Worker is isolated from the workbook generator. It only signs in to Allegro, reads TDR data, and returns the existing TDR payload shape to the GitHub Pages frontend.

Endpoints:

- `GET /api/health`
- `POST /api/tdr`
- `POST /api/tdr/batch` (streaming NDJSON, one Allegro session per bound)

## Cloud-only fallback for HTTP 526 (v2.3.0)

**Live result, 2026-10-14:** the browser fallback reached `Page.navigate` but
Allegro navigation failed with `net::ERR_CONNECTION_RESET`. It did not solve the
live connection issue.

## Independent Node relay (v2.4.0, not yet live-verified)

The new optional transport sends Allegro requests through an authenticated Node.js
relay, which can supplement the officially signed GeoTrust intermediate while
retaining TLS and hostname validation. Configure `ALLEGRO_RELAY_URL` (a Render
HTTPS root URL) and `ALLEGRO_RELAY_TOKEN` (secret). All Allegro requests then use
the relay; the original frontend and streaming response format stay the same.

Deploy and check the relay **before** changing the live Worker. Follow
[`tdr-relay/README.md`](../tdr-relay/README.md). The root `render.yaml` selects a
free service for connectivity testing. Actual Allegro login and TDR results still
require deployed verification.

## Retained Browser Run fallback when the relay is not configured

Normal requests still use the existing direct Allegro API client. If that client
receives HTTP 526 and a `BROWSER` binding is available, the same incoming request
is retried through a short-lived Cloudflare Browser Run Chromium session. No
installation or background service is required on the user's computer.

Chromium certificate validation stays enabled. A navigation certificate error or
a redirect to another origin stops the request. The fallback does not ignore SSL
errors, use HTTP, or send credentials to an arbitrary proxy. Each request owns its
browser session; recording is disabled and the session is closed on completion or
failure. Credentials are used in memory and are not added to logs or health output.

### Deploy from the Cloudflare dashboard

1. Open the existing `space-control-tdr` Worker.
2. Under **Bindings**, add a **Browser Run / Browser Rendering** binding named
   **`BROWSER`**. Keep the existing `SYNC_BACKEND` service binding.
3. Replace the Worker code with the complete `tdr-worker/worker.js` and deploy.
4. Open `/api/health`: it should report `version: "2.4.0"` and
   `browserFallbackAvailable: true`. This verifies configuration, not an Allegro login.
5. Run one single-port TDR query from the existing webpage. Actual connectivity,
   login and TDR data must be verified in the deployed Cloudflare environment
   before considering the certificate issue resolved.

For Wrangler deployment, the browser binding is already included in
`wrangler.jsonc`; deploy this directory with a current Wrangler version.

### Limits and validation

Cloudflare's Workers Free plan includes 10 minutes of browser use per day. A
browser is opened only after HTTP 526, and one session is shared across the ports
in one batch. Quota exhaustion or an unavailable Browser Run binding does not
disable certificate checking; it returns an error instead. Do not upgrade to a
paid plan without the owner's approval.

Run `npm test` for the direct-client, fallback, failure, session-cleanup and
credential-origin regression checks. These are mocked protocol tests; they do not
claim that the live Allegro site accepts Browser Run connections.

References:
- https://developers.cloudflare.com/browser-run/reference/browser-binding-api/
- https://developers.cloudflare.com/browser-run/pricing/
- https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-526/
