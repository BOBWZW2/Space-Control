param([switch]$NoStart)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$appData = Join-Path $env:LOCALAPPDATA 'SpaceControl'
$credentialPath = Join-Path $appData 'tdr-credentials.json'

$form = New-Object System.Windows.Forms.Form
$form.Text = 'Space Control TDR Agent 设置'
$form.StartPosition = 'CenterScreen'
$form.ClientSize = New-Object System.Drawing.Size(440, 245)
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 9)

$title = New-Object System.Windows.Forms.Label
$title.Text = '配置 CULines TDR 登录账号'
$title.Font = New-Object System.Drawing.Font('Microsoft YaHei UI', 12, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(24, 20)
$title.AutoSize = $true
$form.Controls.Add($title)

$note = New-Object System.Windows.Forms.Label
$note.Text = '账号只保存在当前电脑，并由 Windows 用户凭据加密。'
$note.Location = New-Object System.Drawing.Point(25, 52)
$note.Size = New-Object System.Drawing.Size(390, 22)
$note.ForeColor = [System.Drawing.Color]::DimGray
$form.Controls.Add($note)

$userLabel = New-Object System.Windows.Forms.Label
$userLabel.Text = 'USER ID'
$userLabel.Location = New-Object System.Drawing.Point(25, 88)
$userLabel.AutoSize = $true
$form.Controls.Add($userLabel)

$userText = New-Object System.Windows.Forms.TextBox
$userText.Location = New-Object System.Drawing.Point(130, 84)
$userText.Size = New-Object System.Drawing.Size(280, 27)
$form.Controls.Add($userText)

$passwordLabel = New-Object System.Windows.Forms.Label
$passwordLabel.Text = 'PASSWORD'
$passwordLabel.Location = New-Object System.Drawing.Point(25, 130)
$passwordLabel.AutoSize = $true
$form.Controls.Add($passwordLabel)

$passwordText = New-Object System.Windows.Forms.TextBox
$passwordText.Location = New-Object System.Drawing.Point(130, 126)
$passwordText.Size = New-Object System.Drawing.Size(280, 27)
$passwordText.UseSystemPasswordChar = $true
$form.Controls.Add($passwordText)

if (Test-Path -LiteralPath $credentialPath) {
  try {
    $existing = Get-Content -LiteralPath $credentialPath -Raw | ConvertFrom-Json
    $userText.Text = [string]$existing.username
  } catch {}
}

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = '取消'
$cancel.Location = New-Object System.Drawing.Point(242, 184)
$cancel.Size = New-Object System.Drawing.Size(78, 34)
$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.Controls.Add($cancel)

$save = New-Object System.Windows.Forms.Button
$save.Text = '保存并启动'
$save.Location = New-Object System.Drawing.Point(330, 184)
$save.Size = New-Object System.Drawing.Size(80, 34)
$save.Add_Click({
  $username = $userText.Text.Trim()
  if (-not $username -or -not $passwordText.Text) {
    [System.Windows.Forms.MessageBox]::Show('请输入 USER ID 和 PASSWORD。', 'Space Control TDR Agent') | Out-Null
    return
  }
  New-Item -ItemType Directory -Force -Path $appData | Out-Null
  $secure = ConvertTo-SecureString $passwordText.Text -AsPlainText -Force
  $payload = [ordered]@{
    username = $username
    passwordCipher = ConvertFrom-SecureString $secure
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  $payload | ConvertTo-Json | Set-Content -LiteralPath $credentialPath -Encoding UTF8
  $form.Tag = 'saved'
  $form.Close()
})
$form.Controls.Add($save)
$form.AcceptButton = $save
$form.CancelButton = $cancel

[void]$form.ShowDialog()
if ($form.Tag -ne 'saved') { exit 2 }

try {
  Invoke-RestMethod -Uri 'http://127.0.0.1:4318/api/shutdown' -Method Post -TimeoutSec 3 | Out-Null
  Start-Sleep -Milliseconds 800
} catch {}

if (-not $NoStart) {
  Start-Process -FilePath 'powershell.exe' -ArgumentList @(
    '-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass',
    '-File', ('"{0}"' -f (Join-Path $root 'start-tdr-helper.ps1')), '-NoBrowser'
  ) -WindowStyle Hidden
  [System.Windows.Forms.MessageBox]::Show('账号已保存，TDR Agent 正在后台启动。', 'Space Control TDR Agent') | Out-Null
}
