#verify-nsis-install.ps1 -- NSIS installer end-to-end verification (M3-004 Phase 4).
# Generic PowerShell: parameter-driven, no machine-specific secrets, no hard-coded
# absolute paths beyond the product root. Runs against the ACTUAL NSIS artifact:
# silent currentUser install -> layout -> isolated sidecar stdio handshake ->
# mock-launch process assertion -> silent uninstall -> residue checks.
# A human-readable summary plus a machine JSON report land in -ReportDir (LOCAL-ONLY).
#
# Usage:
#   .\scripts\verify-nsis-install.ps1 -Installer artifacts\releases\0.1.0\windows-x86_64\LM-Profile-Switcher_0.1.0_x64-setup.exe
#   # layout-only / keep-installed modes:
#   -SkipLaunch -SkipUninstall -SkipInstall
#
# Default product facts below mirror tauri.conf.json + core-service/index.ts.

param(
  [string]$Installer,
  [string]$UpgradeInstaller,
  [string]$ExpectedVersion,
  [string]$RollbackInstaller,
  [string]$RollbackVersion,
  [string]$ProductName = 'LM Profile Switcher',
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA $ProductName),
  [string]$LMPSHome = (Join-Path (Get-Location) '.workspace\tmp\m3-004-install\home'),
  [string]$ReportDir = (Join-Path (Get-Location) 'reports\m3-004'),
  [switch]$SkipInstall,
  [switch]$SkipLaunch,
  [switch]$SkipUninstall,
  [int]$LaunchWaitSeconds = 6
)

$ErrorActionPreference = 'Stop'

function Assert($cond, $msg) {
  if (-not $cond) { throw "Assertion failed: $msg" }
}

function Write-Step($text) { Write-Host "==> $text" -ForegroundColor Cyan }

# Registered uninstall DisplayVersion under HKCU for the product (or $null).
function Get-DisplayVersion {
  $uninstallBase = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
  $reg = Get-ChildItem $uninstallBase -ErrorAction SilentlyContinue |
    Where-Object { $_.GetValue('DisplayName') -like "*$ProductName*" } | Select-Object -First 1
  if ($reg -eq $null) { return $null }
  return $reg.GetValue('DisplayVersion')
}

# Reads the installed lmps-desktop.exe FileVersion, or $null when absent.
function Get-ExeVersion {
  $exe = Join-Path $InstallDir 'lmps-desktop.exe'
  if (-not (Test-Path $exe)) { return $null }
  return (Get-Item $exe).VersionInfo.FileVersion
}

$results = [ordered]@{}
$results.product = $ProductName
$results.generatedAt = (Get-Date).ToUniversalTime().ToString('o')

try {
  New-Item -ItemType Directory -Force -Path $LMPSHome | Out-Null

  # ---------------------------------------------------------------- install
  if ($SkipInstall) {
    Write-Step '[skip] install (existing install must already be present)'
  } else {
    Assert (Test-Path $Installer) "installer not found: $Installer"
    Write-Step "silent install: $Installer"
    $p = Start-Process -FilePath $Installer -ArgumentList '/S' -Wait -PassThru
    Start-Sleep -Seconds 3
    Assert (Test-Path $InstallDir) "install dir missing after install: $InstallDir"
    $results.installExitCode = $p.ExitCode
    $results.installDir = $InstallDir
  }

  # ------------------------------------------------------------- file layout
  $exe = Join-Path $InstallDir 'lmps-desktop.exe'
  $sidecar = Join-Path $InstallDir 'lmps-sidecar.exe'
  $layout = @{}
  $layout.lmpsDesktopExe = Test-Path $exe
  $layout.lmpsSidecarExe = Test-Path $sidecar
  if ($layout.lmpsDesktopExe) {
    $layout.lmpsDesktopSize = (Get-Item $exe).Length
    $layout.lmpsDesktopVersion = (Get-Item $exe).VersionInfo.FileVersion
  }
  if ($layout.lmpsSidecarExe) {
    $layout.lmpsSidecarSize = (Get-Item $sidecar).Length
  }
  $uninstaller = Get-ChildItem -Path $InstallDir -Filter 'Uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  $layout.uninstallerExe = if ($uninstaller) { $uninstaller.Name } else { $null }
  $results.layout = $layout
  $results.baseDisplayVersion = Get-DisplayVersion
  Assert $layout.lmpsDesktopExe 'lmps-desktop.exe not in install dir'
  Assert $layout.lmpsSidecarExe 'lmps-sidecar.exe not in install dir (externalBin must be deployed)'
  Assert ($null -ne $layout.uninstallerExe) 'uninstaller missing in install dir'

  # ----------------------------------------------------------- upgrade over
  if ($UpgradeInstaller) {
    Assert (Test-Path $UpgradeInstaller) "upgrade installer not found: $UpgradeInstaller"
    Write-Step "overlay upgrade install: $UpgradeInstaller"
    $p = Start-Process -FilePath $UpgradeInstaller -ArgumentList '/S' -Wait -PassThru
    Start-Sleep -Seconds 3
    $upgrade = @{ exitCode = $p.ExitCode; expectedVersion = $ExpectedVersion }
    $upgrade.exeAfter = Get-ExeVersion
    $upgrade.registryDisplayVersionAfter = Get-DisplayVersion
    $results.upgrade = $upgrade
    Assert ($p.ExitCode -eq 0) "overlay upgrade exited $($p.ExitCode)"
    Assert ($upgrade.exeAfter -eq $ExpectedVersion) "upgraded exe version is $($upgrade.exeAfter), expected $ExpectedVersion"
    Assert ($upgrade.registryDisplayVersionAfter -eq $ExpectedVersion) "upgraded registry DisplayVersion is $($upgrade.registryDisplayVersionAfter), expected $ExpectedVersion"
    Write-Step "upgrade OK: installed exe + registry report $ExpectedVersion"
  }

  # ------------------------------------------------------ rollback (downgrade)
  if ($RollbackInstaller) {
    Assert (Test-Path $RollbackInstaller) "rollback installer not found: $RollbackInstaller"
    Assert ($null -ne $RollbackVersion) 'rollback requires -RollbackVersion'
    Write-Step "overlay rollback install: $RollbackInstaller"
    $p = Start-Process -FilePath $RollbackInstaller -ArgumentList '/S' -Wait -PassThru
    Start-Sleep -Seconds 3
    $rollback = @{ exitCode = $p.ExitCode; expectedVersion = $RollbackVersion }
    $rollback.exeAfter = Get-ExeVersion
    $rollback.registryDisplayVersionAfter = Get-DisplayVersion
    $results.rollback = $rollback
    Assert ($p.ExitCode -eq 0) "rollback exited $($p.ExitCode)"
    Assert ($rollback.exeAfter -eq $RollbackVersion) "rollback exe version is $($rollback.exeAfter), expected $RollbackVersion"
    Assert ($rollback.registryDisplayVersionAfter -eq $RollbackVersion) "rollback registry DisplayVersion is $($rollback.registryDisplayVersionAfter), expected $RollbackVersion"
    Write-Step "rollback OK: installed exe + registry report $RollbackVersion"
  }

  # ------------------------------------------------- isolated sidecar handshake
  if ($SkipLaunch) {
    Write-Step '[skip] sidecar handshake + mock launch'
  } else {
    Write-Step 'sidecar stdio handshake (isolated LMPS_HOME, mock adapter)'
    $token = 'lmps-vrf-' + (-join ((1..16) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) }))
    $psi = [System.Diagnostics.ProcessStartInfo]::new()
    $psi.FileName = $sidecar
    $psi.Arguments = "stdio $token"
    $psi.UseShellExecute = $false
    $psi.RedirectStandardInput = $true
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.Environment['LMPS_HOME'] = $LMPSHome
    $psi.Environment['LMPS_ADAPTER'] = 'mock'

    $proc = [System.Diagnostics.Process]::new()
    $proc.StartInfo = $psi
    $proc.Start() | Out-Null

    function Read-Frame {
      param([System.Diagnostics.Process]$P)
      $line = $P.StandardOutput.ReadLine()
      if ($null -eq $line) { throw 'sidecar stdout closed early' }
      return ($line | ConvertFrom-Json)
    }

    try {
      $ready = Read-Frame $proc
      Assert ($ready.event -eq 'ready') "unexpected ready frame: $($ready | ConvertTo-Json -Compress)"
      $proc.StandardInput.WriteLine('{"jsonrpc":"2.0","auth":true,"token":"' + $token + '"}' )
      $auth = Read-Frame $proc
      Assert ($auth.result.authenticated -eq $true) 'sidecar refused/denied auth'

      $proc.StandardInput.WriteLine('{"jsonrpc":"2.0","id":1,"method":"sdkInfo"}')
      $sdk = Read-Frame $proc
      Assert (-not $sdk.error) "sdkInfo error: $($sdk.error | ConvertTo-Json -Compress)"

      $proc.StandardInput.WriteLine('{"jsonrpc":"2.0","id":2,"method":"probeCapabilities","params":{}}')
      $probe = Read-Frame $proc
      Assert (-not $probe.error) "probeCapabilities error: $($probe.error | ConvertTo-Json -Compress)"

      $results.sidecar = [ordered]@{
        transport = 'stdio'
        auth = $auth.result.authenticated
        sdkSdkVersion = $sdk.result.sdkVersion
        probeMatrices = $probe.result.matrices ?? $probe.result.writeSource
      }
    } finally {
      if (-not $proc.HasExited) { $proc.Kill(); $proc.WaitForExit() }
    }
    Write-Step "sidecar handshake OK (mock, isolated home)"

    # ------------------------------------------------------- mock launch, GUI
    Write-Step "launch installed app (LMPS_ADAPTER=mock, home=$LMPSHome)"
    $env:LMPS_HOME = $LMPSHome
    $env:LMPS_ADAPTER = 'mock'
    if (-not $env:LMPS_LM_URL) { $env:LMPS_LM_URL = 'http://127.0.0.1:1234' }
    $app = Start-Process -FilePath $exe -PassThru
    Start-Sleep -Seconds $LaunchWaitSeconds

    $appProc = Get-Process -Name 'lmps-desktop' -ErrorAction SilentlyContinue
    $scProc = Get-Process -Name 'lmps-sidecar' -ErrorAction SilentlyContinue
    $results.launch = [ordered]@{
      mainPid = $app.Id
      mainRunning = ($null -ne $appProc)
      sidecarRunning = ($null -ne $scProc)
      sidecarPid = if ($scProc) { $scProc.Id } else { $null }
    }
    Assert $results.launch.mainRunning 'installed app exited before assertion'
    Assert $results.launch.sidecarRunning 'sidecar not spawned by installed app'

    # Kill the whole tree; assert no orphan sidecar survives.
    if ($appProc) { & taskkill /PID $appProc.Id /T /F | Out-Null }
    Start-Sleep -Seconds 2
    $orphanSc = Get-Process -Name 'lmps-sidecar' -ErrorAction SilentlyContinue
    $results.launch.orphanSidecarAfterTreeKill = ($null -ne $orphanSc)
    Assert (-not $orphanSc) 'orphaned sidecar survived tree-kill'
    Remove-Item Env:LMPS_ADAPTER -ErrorAction SilentlyContinue

    Write-Step "mock launch OK: main + sidecar alive, no orphan after tree-kill"
  }

  # ------------------------------------------------------------- uninstall
  if ($SkipUninstall) {
    Write-Step '[skip] uninstall (keep installed for manual inspection)'
  } else {
    Write-Step 'silent uninstall'
    $uninstallerPath = Join-Path $InstallDir $layout.uninstallerExe
    Assert (Test-Path $uninstallerPath) "uninstaller not found: $uninstallerPath"
    $p = Start-Process -FilePath $uninstallerPath -ArgumentList '/S' -Wait -PassThru
    Start-Sleep -Seconds 3
    $residue = @{}
    $residue.installDirExists = Test-Path $InstallDir
    $residue.lmpsDesktopProc = ($null -ne (Get-Process -Name 'lmps-desktop' -ErrorAction SilentlyContinue))
    $residue.lmpsSidecarProc = ($null -ne (Get-Process -Name 'lmps-sidecar' -ErrorAction SilentlyContinue))
    # Tauri NSIS registers under HKCU by DisplayName, not by app identifier.
    $uninstallBase = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall'
    $regMatch = Get-ChildItem $uninstallBase -ErrorAction SilentlyContinue |
      Where-Object { $_.GetValue('DisplayName') -like "*$ProductName*" } | Select-Object -First 1
    $residue.uninstallRegKey = ($null -ne $regMatch)
    $residue.uninstallDisplayVersion = if ($regMatch) { $regMatch.GetValue('DisplayVersion') } else { $null }
    $results.uninstall = [ordered]@{
      exitCode = $p.ExitCode
      installDirExists = $residue.installDirExists
      lmpsProcesses = ($residue.lmpsDesktopProc -or $residue.lmpsSidecarProc)
      uninstallRegKeyExists = $residue.uninstallRegKey
    }
    Assert (-not ($residue.lmpsDesktopProc -or $residue.lmpsSidecarProc)) 'process residue after uninstall'
    Assert (-not $residue.uninstallRegKey) 'uninstall registry key not removed'
    Write-Step 'uninstall OK: no process or registry residue'
  }

  $results.ok = $true
} catch {
  $results.ok = $false
  $results.error = $_.Exception.Message
  Write-Error $_
}

New-Item -ItemType Directory -Force -Path $ReportDir | Out-Null
$reportFile = Join-Path $ReportDir ("nsis-install-" + (Get-Date).ToString('yyyyMMdd-HHmmss') + '.json')
$results | ConvertTo-Json -Depth 8 | Set-Content -Path $reportFile -Encoding utf8
Write-Host "report: $reportFile"
if ($results.ok) {
  Write-Host "[ok] NSIS install verification PASSED"
  exit 0
} else {
  Write-Host "[FAIL] NSIS install verification FAILED: $($results.error)"
  exit 1
}