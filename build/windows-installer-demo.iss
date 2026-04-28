#define MyAppName "Gestionale Demo"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Publisher modificabile"
#define MyAppExeName "Gestionale Demo.exe"
#define MyAppId "com.company.gestionale.demo"
#define MyAppDataDirName "GestionaleDemo"
#define MySourceDir "..\\release-demo\\win-unpacked"
#define MyOutputDir "..\\release-demo\\inno"
#define MyIconFile "..\\build\\resources\\icon.ico"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Gestionale\Demo
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir={#MyOutputDir}
OutputBaseFilename={#MyAppName}-Setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
SetupIconFile={#MyIconFile}
UninstallDisplayIcon={app}\{#MyAppExeName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
CloseApplications=yes
RestartApplications=no
UsePreviousAppDir=yes

[Languages]
Name: "italian"; MessagesFile: "compiler:Languages\Italian.isl"

[Tasks]
Name: "desktopicon"; Description: "Crea collegamento sul desktop"; GroupDescription: "Collegamenti:"

[Files]
Source: "{#MySourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; IconFilename: "{#MyIconFile}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; IconFilename: "{#MyIconFile}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Avvia {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  UserDataPath: string;
  RemoveData: Integer;
begin
  if CurUninstallStep = usPostUninstall then
  begin
    UserDataPath := ExpandConstant('{userappdata}\{#MyAppDataDirName}');
    if DirExists(UserDataPath) then
    begin
      RemoveData := MsgBox(
        'Vuoi rimuovere anche i dati demo locali?' + #13#10 + #13#10 +
        'Se scegli "No", database demo, backup, documenti e impostazioni demo resteranno disponibili per future reinstallazioni.',
        mbConfirmation,
        MB_YESNO
      );

      if RemoveData = IDYES then
      begin
        DelTree(UserDataPath, True, True, True);
      end;
    end;
  end;
end;
