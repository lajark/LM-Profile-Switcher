# provision-shell-deps.ps1 -- Provision the native WebDriver used by the
# Windows-shell E2E suite (M6-004 Slice B).
#
# tauri-driver drives WebView2 through Microsoft Edge WebDriver, and the driver
# major/minor/build must match the installed WebView2 Runtime or sessions hang
# during connect. This script detects the Runtime version, downloads the
# matching driver into a LOCAL-ONLY cache, and prints the exe path as its final
# stdout line (wdio.shell.conf.ts consumes that path via --native-driver).
#
# Usage:
#   .\scripts\provision-shell-deps.ps1
#   $env:LMPS_WEBVIEW2_VERSION = '152.0.4191.66'; .\scripts\provision-shell-deps.ps1
#
# Override the cache root with -CacheDir (default .workspace/tools/msedgedriver).

[CmdletBinding()]
param(
  [string]$CacheDir = (Join-Path (Get-Location) '.workspace\tools\msedgedriver'),
  # Pin a version instead of auto-detecting (CI reproducibility / diagnosis).
  [string]$Version = $env:LMPS_WEBVIEW2_VERSION
)

$ErrorActionPreference = 'Stop'

function Get-WebView2Version {
  # Most machines register the Runtime in the uninstall hive; that entry
  # names the runtime explicitly, so prefer it over the Edge browser version.
  $uninstallRoots = @(
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $uninstallRoots) {
    if (Test-Path $root) {
      $entry = Get-ItemProperty (Join-Path $root '*') -ErrorAction SilentlyContinue |
        Where-Object { $_.DisplayName -like '*WebView2 Runtime*' -and $_.DisplayVersion -match '^\d+\.\d+\.\d+\.\d+$' } |
        Select-Object -First 1
      if ($entry) { return $entry.DisplayVersion }
    }
  }
  # Fallback: EdgeUpdate client GUIDs for the runtime, then Edge browser.
  $clients = @(
    @{ Hive = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients'; Guid = '{F3017226-FE2A-4295-8BDF-00C3AA946BAE}' },
    @{ Hive = 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients'; Guid = '{F3017226-FE2A-4295-8BDF-00C3AA946BAE}' },
    @{ Hive = 'HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients'; Guid = '{F3017226-FE2A-4295-8BDF-00C3AA946BAE}' },
    @{ Hive = 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients'; Guid = '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}' },
    @{ Hive = 'HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients'; Guid = '{56EB18F8-B008-4CBD-B6D2-8C97FE7E9062}' }
  )
  foreach ($client in $clients) {
    $key = Join-Path $client.Hive $client.Guid
    if (Test-Path $key) {
      $pv = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).pv
      if ($pv -match '^\d+\.\d+\.\d+\.\d+$') { return $pv }
    }
  }
  throw 'Could not detect the WebView2 Runtime (or Edge) version from the registry.'
}

if (-not $Version) { $Version = Get-WebView2Version }
Write-Host "[provision] WebView2/Edge version: $Version"

$versionDir = Join-Path $CacheDir $Version
$driverExe = Join-Path $versionDir 'msedgedriver.exe'
if (Test-Path $driverExe) {
  Write-Host '[provision] Driver already cached.'
  Write-Output $driverExe
  exit 0
}

New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
$zipPath = Join-Path ([System.IO.Path]::GetTempPath()) "msedgedriver-$Version.zip"
$urls = @(
  "https://msedgedriver.microsoft.com/$Version/edgedriver_win64.zip",
  "https://msedgedriver.azureedge.net/$Version/edgedriver_win64.zip",
  "https://msedgewebdriverstorage.blob.core.windows.net/edgewebdriver/$Version/edgedriver_win64.zip"
)

$downloaded = $false
# TLS handshakes to the CDN can fail on flaky/restrictive networks; retry.
foreach ($url in $urls) {
  for ($attempt = 1; $attempt -le 4; $attempt++) {
    try {
      Write-Host "[provision] Downloading $url (attempt $attempt)"
      Invoke-WebRequest -Uri $url -OutFile $zipPath -TimeoutSec 120
      $downloaded = $true
      break
    } catch {
      Write-Warning "Download failed: $($_.Exception.Message)"
      Start-Sleep -Seconds 2
    }
  }
  if ($downloaded) { break }
}
if (-not $downloaded) { throw "Unable to download MSEdgeDriver $Version from any mirror." }

Expand-Archive -Path $zipPath -DestinationPath $versionDir -Force
Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
if (-not (Test-Path $driverExe)) { throw "Archive extracted but msedgedriver.exe missing under $versionDir" }

Write-Host '[provision] Driver ready.'
Write-Output $driverExe
