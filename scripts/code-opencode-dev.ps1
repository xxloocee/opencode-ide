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
$openCodePackageDir = Join-Path $openCodeRootPath 'packages\opencode'
$generativeUiConfigDir = Join-Path $openCodeRootPath 'packages\opencode-generative-ui\runtime-config'
$userDataDir = Join-Path $repoRoot ".build\$ProfileName\data"
$settingsDir = Join-Path $userDataDir 'User'
$settingsFile = Join-Path $settingsDir 'settings.json'
$bunCommand = Get-Command bun -ErrorAction SilentlyContinue
$bunExe = if ($bunCommand) { $bunCommand.Source } else { $null }

if (!(Test-Path $codeBat)) {
  throw "VS Code dev launcher not found: $codeBat"
}

if (!(Test-Path $openCodeRootPath)) {
  throw "OpenCode source repo not found: $openCodeRootPath"
}

if (!$bunExe) {
  throw 'bun is not available on PATH.'
}

if (!(Test-Path (Join-Path $openCodePackageDir 'src\index.ts'))) {
  throw "OpenCode source entrypoint not found: $openCodePackageDir\src\index.ts"
}

if (!(Test-Path (Join-Path $generativeUiConfigDir 'package.json'))) {
  throw "Generative UI runtime config not found: $generativeUiConfigDir"
}

New-Item -ItemType Directory -Force -Path $settingsDir | Out-Null

$command = "`"$bunExe`" run --cwd `"$openCodePackageDir`" --conditions=browser ./src/index.ts serve"

$settings = [ordered]@{
  "sessions.openCode.command" = $command
  "sessions.openCode.cwd" = $openCodeRootPath
  "sessions.openCode.uiPackage" = "app-ide"
  "sessions.openCode.enableGenerativeUiCsp" = $true
}
$settingsJson = $settings | ConvertTo-Json
Set-Content -LiteralPath $settingsFile -Value $settingsJson -Encoding utf8

Write-Host "OpenCode dev profile prepared at $userDataDir"
Write-Host "OpenCode source: $openCodeRootPath"
Write-Host "OpenCode runtime: $bunExe run --cwd $openCodePackageDir --conditions=browser ./src/index.ts serve"
Write-Host "Generative UI config: $generativeUiConfigDir"
Write-Host "Settings file: $settingsFile"

if ($NoLaunch) {
  Write-Host 'Skipping IDE launch because -NoLaunch was provided.'
  exit 0
}

$env:OPENCODE_CONFIG_DIR = $generativeUiConfigDir
& $codeBat "--user-data-dir=$userDataDir" @CodeArgs
exit $LASTEXITCODE
