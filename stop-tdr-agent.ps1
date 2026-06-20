$ErrorActionPreference = 'SilentlyContinue'
$pidFile = Join-Path $env:LOCALAPPDATA 'SpaceControl\tdr-helper-4318.pid'

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/shutdown' -Method Post -TimeoutSec 3 | Out-Null
} catch {}

for ($i = 0; $i -lt 20; $i++) {
  if (-not (Get-NetTCPConnection -LocalPort 4318 -State Listen -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 250
}

if (Test-Path -LiteralPath $pidFile) {
  $agentPid = [int](Get-Content -LiteralPath $pidFile -Raw)
  $process = Get-CimInstance Win32_Process -Filter "ProcessId=$agentPid"
  if ($process -and $process.CommandLine -match 'server\.mjs') {
    Stop-Process -Id $agentPid -Force
  }
  Remove-Item -LiteralPath $pidFile -Force
}

$profile = Join-Path $env:LOCALAPPDATA 'SpaceControl\tdr-browser-profile'
$profilePattern = [regex]::Escape($profile)
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('chrome.exe', 'msedge.exe') -and $_.CommandLine -match $profilePattern
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}
