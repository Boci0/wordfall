<#
  install.ps1 — install the published Wordfall build into the user's profile and
  (re)create the desktop shortcut.

  Usage (from the wordfall/ folder):
    powershell -NoProfile -ExecutionPolicy Bypass -File install.ps1

  It copies dist\Wordfall-win64 to %LOCALAPPDATA%\Programs\Wordfall and points
  %USERPROFILE%\Desktop\Wordfall.lnk at the installed exe. WebView2 data (and the
  best score) live in %LOCALAPPDATA%\Wordfall, so reinstalling keeps them.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$src = Join-Path $root 'dist\Wordfall-win64'
$exeSrc = Join-Path $src 'Wordfall.exe'

if (-not (Test-Path $exeSrc)) {
  throw "No published build at $src. Run: powershell -NoProfile -ExecutionPolicy Bypass -File win\build.ps1"
}

$target = Join-Path $env:LOCALAPPDATA 'Programs\Wordfall'
New-Item -ItemType Directory -Force -Path $target | Out-Null

Get-ChildItem $src -File | Copy-Item -Destination $target -Force
$runtimes = Join-Path $src 'runtimes'
if (Test-Path $runtimes) {
  Copy-Item $runtimes $target -Recurse -Force
}
Get-ChildItem $target -File -Filter 'smoke-result.json' -ErrorAction SilentlyContinue |
  Remove-Item -Force -ErrorAction SilentlyContinue

$exe = Join-Path $target 'Wordfall.exe'
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Wordfall.lnk'

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnk)
$shortcut.TargetPath = $exe
$shortcut.WorkingDirectory = $target
$shortcut.IconLocation = "$exe,0"
$shortcut.Description = 'Wordfall - a 1995-style typing game'
$shortcut.WindowStyle = 1
$shortcut.Save()

Write-Host "Installed: $exe"
Write-Host "Shortcut:  $lnk"
