# Space Control

Online workbook generator: https://bobwzw2.github.io/Space-Control/

## Main files

- `index.html` / `space-control-generator.html`: browser application and Excel export logic.
- `tdr-helper/server.mjs`: local background Agent that reads actual TDR volume from Allegro.
- `installer/SpaceControlTdrAgent.iss`: Windows installer source.
- `start-tdr-helper.ps1`: starts the Agent silently on Windows.

## TDR update

The online page calls the installed Agent on `127.0.0.1:4318`. Allegro remains in the background; credentials are encrypted separately for each Windows user and are never stored in this repository or sent to GitHub. Multiple computers may install the Agent and use the same Allegro account; initial-login conflicts are retried automatically.

The TDR action checks every POL in the active bound, shows per-POL status and percentage progress, and writes a POL only after all of its data and required decisions are complete. Skipped PODs, unknown SO codes, exceptional CUL CO codes, missing terminals, and failed POLs are confirmed in the page before import.

The dialog also supports a single-port mode for later TDR rechecks. It queries only the selected POL and generates one paste block per carrier sheet, with the exact target sheet, cell range, and starting cell shown. These blocks contain only the `LILIAN` through `Weight` input area, so pasting them into an earlier exported workbook does not replace other POL changes or the workbook's `TTL`, `TOTAL`, `ROB`, and utilisation formulas. TOTAL sheets recalculate from their carrier sheets and are not pasted directly.

Equipment mapping is `20ft + 20ftHC -> 20'` and `40ft + 40ftHC + 45ft -> 40'`. Empty containers go to `MT`. Reefer quantities are deducted from their original category and moved to `RF`; weight is counted only once. Multi-partner TOTAL sheets include a `Partner` row and audit comments on the relevant POD and TOTAL cells.

Download the latest Windows installer from the page's TDR dialog or from [GitHub Releases](https://github.com/BOBWZW2/Space-Control/releases/latest). The installer bundles its runtime, starts with Windows, detects Chrome or Edge automatically, and opens an account setup dialog on first install. The local credential file is encrypted by Windows DPAPI and stays under the current user's local application data folder.

On each computer, allow the browser's one-time local-network access request for the Space Control site. This permission lets the HTTPS page reach only the Agent running on that computer; TDR credentials and results are not uploaded to GitHub.
