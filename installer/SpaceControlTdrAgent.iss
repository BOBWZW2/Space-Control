#define MyAppName "Space Control TDR Agent"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "CULines Space Control"
#define MyAppURL "https://bobwzw2.github.io/Space-Control/"

[Setup]
AppId={{84C18C79-F19E-4C54-B7AB-7386F5C70D83}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={localappdata}\Programs\SpaceControlTdrAgent
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\outputs
OutputBaseFilename=SpaceControl-TDR-Agent-Setup-1.0.0
Compression=lzma2/ultra64
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}

[Files]
Source: "..\runtime\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
Source: "..\tdr-helper\server.mjs"; DestDir: "{app}\tdr-helper"; Flags: ignoreversion
Source: "..\tdr-helper\package.json"; DestDir: "{app}\tdr-helper"; Flags: ignoreversion
Source: "..\tdr-helper\node_modules\*"; DestDir: "{app}\tdr-helper\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "..\space-control-generator.html"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\start-tdr-helper.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\configure-tdr-agent.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\stop-tdr-agent.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\打开 Space Control"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\start-tdr-helper.ps1"""; WorkingDir: "{app}"
Name: "{group}\设置 TDR 账号"; Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure-tdr-agent.ps1"""; WorkingDir: "{app}"
Name: "{userdesktop}\Space Control"; Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\start-tdr-helper.ps1"""; WorkingDir: "{app}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "SpaceControlTdrAgent"; ValueData: "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\start-tdr-helper.ps1"" -NoBrowser"; Flags: uninsdeletevalue

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\configure-tdr-agent.ps1"" -NoStart"; Description: "配置共享 TDR 账号"; Flags: postinstall waituntilterminated skipifsilent; Check: CredentialsMissing
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\start-tdr-helper.ps1"" -NoBrowser"; Flags: postinstall runhidden nowait
Filename: "{#MyAppURL}"; Description: "打开 Space Control"; Flags: postinstall shellexec skipifsilent unchecked

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File ""{app}\stop-tdr-agent.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "StopAgent"

[Code]
function CredentialsMissing: Boolean;
begin
  Result := not FileExists(ExpandConstant('{localappdata}\SpaceControl\tdr-credentials.json'));
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  ResultCode: Integer;
  StopScript: String;
begin
  Result := '';
  StopScript := ExpandConstant('{app}\stop-tdr-agent.ps1');
  if FileExists(StopScript) then
    Exec(
      ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
      '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + StopScript + '"',
      '', SW_HIDE, ewWaitUntilTerminated, ResultCode
    );
end;
