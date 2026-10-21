<#
  build.ps1 - builds and publishes the native Wordfall Windows app.

  Usage (Windows PowerShell 5.1 or PowerShell 7):
    powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1 -Smoke
    powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1 -Configuration Debug -Smoke

  Output:
    dist\Wordfall-win64\Wordfall.exe   (framework-dependent, single-file, win-x64)

  -Smoke runs the published exe with --smoke and prints smoke-result.json.
#>
[CmdletBinding()]
param(
  [string]$Configuration = 'Release',
  [switch]$NoRestore,
  [switch]$Smoke
)

$ErrorActionPreference = 'Stop'

# Windows PowerShell 5.1 does not populate $PSScriptRoot inside param defaults,
# so all paths are resolved here in the script body.
$winDir = $PSScriptRoot
$root = Split-Path -Parent $winDir
$project = Join-Path $winDir 'Wordfall.csproj'
$out = Join-Path $root 'dist\Wordfall-win64'
$ico = Join-Path $winDir 'wordfall.ico'
$exe = Join-Path $out 'Wordfall.exe'

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw '.NET SDK not found on PATH. Install the .NET 10 SDK and try again.'
}

# The icon is committed, but regenerate it if it went missing.
if (-not (Test-Path $ico)) {
  Write-Host 'wordfall.ico missing, generating it...'
  & (Join-Path $winDir 'make-icon.ps1') -OutPath $ico
}
if (-not (Test-Path $ico)) { throw "icon generation failed: $ico not found" }

if (Test-Path $out) { Remove-Item $out -Recurse -Force }
New-Item -ItemType Directory -Force -Path $out | Out-Null

$publishArgs = @(
  'publish', $project,
  '-c', $Configuration,
  '-r', 'win-x64',
  '--self-contained', 'false',
  '-o', $out
)
if ($NoRestore) { $publishArgs += '--no-restore' }

Write-Host "dotnet $($publishArgs -join ' ')"
& dotnet @publishArgs
if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed (exit code $LASTEXITCODE)" }

if (-not (Test-Path $exe)) { throw "publish reported success but $exe is missing" }

$exeInfo = Get-Item $exe
Write-Host ''
Write-Host ("Output: {0}" -f $exeInfo.FullName)
Write-Host ("Size:   {0} MB" -f ([Math]::Round($exeInfo.Length / 1MB, 2)))
Write-Host 'Files:'
Get-ChildItem $out |
  Select-Object Name, @{ Name = 'MB'; Expression = { [Math]::Round($_.Length / 1MB, 2) } } |
  Format-Table -AutoSize |
  Out-String |
  Write-Host

if ($Smoke) {
  # Result file outside Documents: Windows Defender Controlled Folder Access blocks
  # unsigned apps from writing into the user's Documents folder on some machines.
  # When run from a sandboxed workspace (agent environments), executables launched from
  # the workspace are also read-only, so the smoke run falls back to a temp copy of the
  # identical published binaries before reporting failure.
  $resultPath = Join-Path $env:TEMP 'wordfall-smoke-result.json'
  $runDir = Join-Path $env:TEMP 'Wordfall-smoke-run'

  function Invoke-SmokeRun([string]$runDirectory, [string]$runExe) {
    if (Test-Path $resultPath) { Remove-Item $resultPath -Force }
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $runExe
    $psi.Arguments = ('--smoke --smoke-out="{0}"' -f $resultPath)
    $psi.WorkingDirectory = $runDirectory
    $psi.UseShellExecute = $false
    $psi.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($psi)
    if (-not $process.WaitForExit(120000)) {
      try { $process.Kill() } catch { }
      return 124
    }
    return $process.ExitCode
  }

  Write-Host 'Running published exe with --smoke ...'
  $exitCode = Invoke-SmokeRun $out $exe
  $resultWritten = Test-Path $resultPath

  $sandboxBlocked = ($exitCode -ne 0) -and (-not $resultWritten)
  if ($sandboxBlocked) {
    Write-Warning 'Smoke could not write its result from the workspace folder; retrying from a temp copy of the published binaries.'
    if (Test-Path $runDir) { Remove-Item $runDir -Recurse -Force }
    Copy-Item $out $runDir -Recurse
    $exitCode = Invoke-SmokeRun $runDir (Join-Path $runDir 'Wordfall.exe')
  }

  Write-Host ("smoke exit code: {0}" -f $exitCode)
  if (Test-Path $resultPath) {
    Get-Content $resultPath -Raw | Write-Host
  } else {
    Write-Warning "smoke result was not written to $resultPath"
  }

  if ($exitCode -ne 0) {
    throw ("smoke failed (exit code {0})" -f $exitCode)
  }
  Write-Host 'smoke PASSED'
}
