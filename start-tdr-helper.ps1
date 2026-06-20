param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$helper = Join-Path $root 'tdr-helper\server.mjs'
$appData = Join-Path $env:LOCALAPPDATA 'SpaceControl'
$credentialPath = Join-Path $appData 'tdr-credentials.json'
$logDir = Join-Path $appData 'logs'
$port = 4318

try {
  Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 | Out-Null
  if (-not $NoBrowser) { Start-Process 'https://bobwzw2.github.io/Space-Control/' }
  exit 0
} catch {}

if (-not (Test-Path -LiteralPath $credentialPath)) {
  if (-not $NoBrowser) {
    & (Join-Path $root 'configure-tdr-agent.ps1')
  }
  if (-not (Test-Path -LiteralPath $credentialPath)) { exit 2 }
}

$credential = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
$secure = ConvertTo-SecureString $credential.passwordCipher
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
try {
  $env:ALLEGRO_USER = $credential.username
  $env:ALLEGRO_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
} finally {
  [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
}

$node = Join-Path $root 'runtime\node.exe'
if (-not (Test-Path -LiteralPath $node)) {
  $node = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
}
if (-not $node) {
  $node = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $node)) { throw "Node.js was not found." }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir 'tdr-helper.out.log'
$stderr = Join-Path $logDir 'tdr-helper.err.log'
Start-Process -FilePath $node -ArgumentList @('server.mjs') -WorkingDirectory (Join-Path $root 'tdr-helper') -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Milliseconds 500
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 2 | Out-Null
    if (-not $NoBrowser) { Start-Process 'https://bobwzw2.github.io/Space-Control/' }
    exit 0
  } catch {}
}

throw "TDR helper failed to start. Check $stderr"
