# Space Control

Online workbook generator: https://bobwzw2.github.io/Space-Control/

## Main files

- `index.html` / `space-control-generator.html`: browser application and Excel export logic.
- `tdr-helper/server.mjs`: local background bridge that reads actual TDR volume from Allegro.
- `start-tdr-helper.ps1`: starts the bridge silently on Windows.

## TDR update

The online page calls the helper on `127.0.0.1:4318`. Allegro remains in the background; credentials are never stored in this repository or sent to GitHub. Skipped-port cargo must be confirmed in the page before it is written to the workbook.

Install the helper dependencies with `pnpm install` in `tdr-helper`, then run `start-tdr-helper.ps1`. The local credential file is encrypted by Windows DPAPI and stays under the current user's local application data folder.
