<#
.SYNOPSIS
Builds the clean OpenCode IDE Windows system installer on a local machine.

.DESCRIPTION
This script mirrors the Windows part of .github/workflows/build-quantcode-installers.yml
and adds the local toolchain pins that are needed on the current build machine.

It intentionally keeps baseline runtime skipping behind an explicit switch because
skipping the baseline is useful for local recovery, but should not be treated as
release parity.
#>
[CmdletBinding()]
param(
	[ValidateSet('x64', 'arm64')]
	[string] $Arch = 'x64',

	[string] $VCToolsVersion = '14.42.34433',

	[switch] $SkipSanitize,

	[switch] $SkipNpmCi,

	[switch] $SkipBaseline,

	[switch] $SkipMin,

	[switch] $ValidateOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Invoke-NativeStep {
	param(
		[Parameter(Mandatory = $true)]
		[string] $Name,

		[Parameter(Mandatory = $true)]
		[string[]] $Command
	)

	Write-Host ""
	Write-Host "==> $Name"
	Write-Host "    $($Command -join ' ')"

	$executable = $Command[0]
	$arguments = @()
	if ($Command.Length -gt 1) {
		$arguments = $Command[1..($Command.Length - 1)]
	}

	& $executable @arguments
	if ($LASTEXITCODE -ne 0) {
		throw "Command failed with exit code ${LASTEXITCODE}: $($Command -join ' ')"
	}
}

function Add-WindowsSdkToolsToPath {
	$sdkRoot = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
	if (-not (Test-Path -LiteralPath $sdkRoot)) {
		throw "Windows SDK tools directory was not found: $sdkRoot"
	}

	$signtool = Get-ChildItem -Path $sdkRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
		Where-Object { $_.FullName -match '\\(x64|arm64)\\signtool\.exe$' } |
		Sort-Object FullName -Descending |
		Select-Object -First 1

	if (-not $signtool) {
		throw "signtool.exe was not found under $sdkRoot"
	}

	$env:PATH = "$($signtool.DirectoryName);$env:PATH"
	Write-Host "Using signtool from $($signtool.FullName)"
}

function Get-RequiredNodeVersion {
	param([string] $RepoRoot)

	$nvmrc = Join-Path $RepoRoot '.nvmrc'
	if (-not (Test-Path -LiteralPath $nvmrc)) {
		throw ".nvmrc was not found at $nvmrc"
	}

	return (Get-Content -LiteralPath $nvmrc -Encoding UTF8 | Select-Object -First 1).Trim().TrimStart('v')
}

if ([System.Environment]::OSVersion.Platform -ne 'Win32NT') {
	throw 'This script is only supported on Windows.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $repoRoot

$requiredNode = Get-RequiredNodeVersion -RepoRoot $repoRoot
$actualNode = (& node -p "process.version.replace(/^v/, '')").Trim()
if ($LASTEXITCODE -ne 0) {
	throw 'Unable to run node. Install Node.js and try again.'
}
if ($actualNode -ne $requiredNode) {
	throw "Node.js $requiredNode is required by .nvmrc, but current Node.js is $actualNode. Run `nvm use $requiredNode` first."
}

$env:GYP_MSVS_VERSION = '2022'
$env:npm_config_msvs_version = '2022'
$env:VCToolsVersion = $VCToolsVersion
$env:PreferredToolArchitecture = 'x64'

if ($SkipBaseline) {
	$env:ERGOUZICODE_OPENCODE_SKIP_BASELINE = '1'
	Write-Host 'Skipping OpenCode baseline runtime build because -SkipBaseline was passed.'
} else {
	Remove-Item Env:\ERGOUZICODE_OPENCODE_SKIP_BASELINE -ErrorAction SilentlyContinue
}

Add-WindowsSdkToolsToPath

Write-Host ''
Write-Host 'Local Windows release build environment:'
Write-Host "  repo: $repoRoot"
Write-Host "  arch: $Arch"
Write-Host "  node: $actualNode"
Write-Host "  GYP_MSVS_VERSION: $env:GYP_MSVS_VERSION"
Write-Host "  npm_config_msvs_version: $env:npm_config_msvs_version"
Write-Host "  VCToolsVersion: $env:VCToolsVersion"
Write-Host "  PreferredToolArchitecture: $env:PreferredToolArchitecture"
Write-Host "  ERGOUZICODE_OPENCODE_SKIP_BASELINE: $env:ERGOUZICODE_OPENCODE_SKIP_BASELINE"

if ($ValidateOnly) {
	Write-Host ''
	Write-Host 'Validation completed. No build commands were run because -ValidateOnly was passed.'
	exit 0
}

if (-not $SkipSanitize) {
	Invoke-NativeStep 'Run sanitize tests' @('node', 'tools\sanitize\sanitize.test.mjs')
	Invoke-NativeStep 'Apply clean-full sanitize profile' @('node', 'tools\sanitize\apply.mjs', '--profile=clean-full')
	Invoke-NativeStep 'Verify clean-full sanitize profile' @('node', 'tools\sanitize\verify.mjs', '--profile=clean-full')
}

if (-not $SkipNpmCi) {
	Invoke-NativeStep 'Install OpenCode IDE dependencies' @('npm', 'ci')
}

if (-not $SkipMin) {
	Invoke-NativeStep 'Build Windows min client' @('npm', 'run', 'gulp', "vscode-win32-$Arch-min")
}

Invoke-NativeStep 'Build Windows system setup' @('npm', 'run', 'gulp', "vscode-win32-$Arch-system-setup")

$setupPath = Join-Path $repoRoot ".build\win32-$Arch\system-setup\VSCodeSetup.exe"
if (-not (Test-Path -LiteralPath $setupPath)) {
	throw "Build completed but installer was not found: $setupPath"
}

$setup = Get-Item -LiteralPath $setupPath
Write-Host ''
Write-Host "Windows system setup created: $($setup.FullName)"
Write-Host "Size: $($setup.Length) bytes"
