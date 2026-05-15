param(
  [string]$OpenCodeRoot = 'D:\Project\Wan\opencode-private',
  [string]$ProfileName = 'opencode-app-ide-dev',
  [switch]$NoLaunch,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$CodeArgs
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
$codeBat = Join-Path $scriptDir 'code.bat'
$openCodeRootPath = [System.IO.Path]::GetFullPath($OpenCodeRoot)
$generativeUiConfigDir = Join-Path $openCodeRootPath 'packages\opencode-generative-ui\runtime-config'
$userDataDir = Join-Path $repoRoot ".build\$ProfileName\data"
$settingsDir = Join-Path $userDataDir 'User'
$settingsFile = Join-Path $settingsDir 'settings.json'
$runtimeCandidates = @(
  (Join-Path $openCodeRootPath 'packages\opencode\dist\opencode-windows-x64\bin\opencode.exe'),
  (Join-Path $openCodeRootPath 'packages\opencode\dist\opencode-windows-arm64\bin\opencode.exe')
)
$runtimeExe = $runtimeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1

if (!(Test-Path $codeBat)) {
  throw "VS Code dev launcher not found: $codeBat"
}

if (!(Test-Path $openCodeRootPath)) {
  throw "OpenCode source repo not found: $openCodeRootPath"
}

if (!(Get-Command bun -ErrorAction SilentlyContinue)) {
  throw 'bun is not available on PATH.'
}

if (!$runtimeExe) {
  throw "Built OpenCode runtime not found under $openCodeRootPath\packages\opencode\dist. Build packages/opencode first."
}

if (!(Test-Path (Join-Path $generativeUiConfigDir 'package.json'))) {
  throw "Generative UI runtime config not found: $generativeUiConfigDir"
}

New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

$command = "`"$runtimeExe`" serve"

$jsonCommand = $command.Replace('\', '\\').Replace('"', '\"')
$jsonCwd = $openCodeRootPath.Replace('\', '\\')
$settingsJson = @"
{
  "sessions.openCode.command": "$jsonCommand",
  "sessions.openCode.cwd": "$jsonCwd",
  "sessions.openCode.uiPackage": "app-ide",
  "sessions.openCode.enableGenerativeUiCsp": true
}
"@
[System.IO.File]::WriteAllText($settingsFile, $settingsJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "OpenCode dev profile prepared at $userDataDir"
Write-Host "OpenCode source: $openCodeRootPath"
Write-Host "OpenCode runtime: $runtimeExe"
Write-Host "Generative UI config: $generativeUiConfigDir"
Write-Host "Settings file: $settingsFile"

if ($NoLaunch) {
  Write-Host 'Skipping IDE launch because -NoLaunch was provided.'
  exit 0
}

$env:OPENCODE_CONFIG_DIR = $generativeUiConfigDir
& $codeBat "--user-data-dir=$userDataDir" @CodeArgs
exit $LASTEXITCODE
