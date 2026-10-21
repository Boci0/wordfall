<#
  make-icon.ps1 - generates win/wordfall.ico (16/32/48/256) with System.Drawing.

  The mark is a tiny Windows 95-style window: light-gray beveled frame, navy
  title bar with min/max/close buttons, sunken client area holding a white "W"
  (the Wordfall word). No external tools or downloads; PNG-compressed ICO
  entries are supported by Windows Vista and newer.

  Usage:  pwsh -File win\make-icon.ps1 [-OutPath win\wordfall.ico]
#>
[CmdletBinding()]
param(
  [string]$OutPath
)

$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 does not populate $PSScriptRoot inside param defaults.
if (-not $OutPath) { $OutPath = Join-Path $PSScriptRoot 'wordfall.ico' }
Add-Type -AssemblyName System.Drawing

$sizes = @(16, 32, 48, 256)

function New-Brush([int]$r, [int]$g, [int]$b) {
  return New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, $r, $g, $b))
}

function Draw-Mark([int]$s) {
  $bmp = New-Object System.Drawing.Bitmap($s, $s, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::None
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::Half
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit

  $gray   = New-Brush 192 192 192
  $white  = New-Brush 255 255 255
  $dark   = New-Brush 128 128 128
  $black  = New-Brush 0 0 0
  $navy   = New-Brush 0 0 128
  $navyInk = New-Brush 16 16 96
  $pens = @()

  try {
    # Base fill (classic dialog gray).
    $g.FillRectangle($gray, 0, 0, $s, $s)

    $border = if ($s -ge 48) { 2 } elseif ($s -ge 24) { 1 } else { 1 }
    $bevel  = if ($s -ge 48) { 2 } else { 1 }

    # Black outer frame.
    $g.FillRectangle($black, 0, 0, $s, $border)
    $g.FillRectangle($black, 0, $s - $border, $s, $border)
    $g.FillRectangle($black, 0, 0, $border, $s)
    $g.FillRectangle($black, $s - $border, 0, $border, $s)

    # Raised bevel: white on top/left, dark gray on bottom/right.
    $innerX = $border
    $innerY = $border
    $innerW = $s - 2 * $border
    $innerH = $s - 2 * $border
    $g.FillRectangle($white, $innerX, $innerY, $innerW, $bevel)
    $g.FillRectangle($white, $innerX, $innerY, $bevel, $innerH)
    $g.FillRectangle($dark, $innerX, $innerY + $innerH - $bevel, $innerW, $bevel)
    $g.FillRectangle($dark, $innerX + $innerW - $bevel, $innerY, $bevel, $innerH)

    $frame = $border + $bevel
    $frameW = $s - 2 * $frame

    # Navy title bar.
    $titleH = [Math]::Max(3, [int][Math]::Round($s * 0.20))
    $g.FillRectangle($navy, $frame, $frame, $frameW, $titleH)

    # Title-bar buttons (skip on the smallest sizes, where they turn to mush).
    if ($s -ge 32) {
      $btn = [Math]::Max(2, [int][Math]::Round($s * 0.115))
      $gap = [Math]::Max(1, [int][Math]::Round($s * 0.02))
      $btnY = $frame + [Math]::Max(1, [int][Math]::Floor(($titleH - $btn) / 2))
      $x = $frame + $frameW - $gap
      for ($i = 0; $i -lt 3; $i++) {
        $x = $x - $btn
        # Button face + bevel.
        $g.FillRectangle($gray, $x, $btnY, $btn, $btn)
        $g.FillRectangle($white, $x, $btnY, $btn, 1)
        $g.FillRectangle($white, $x, $btnY, 1, $btn)
        $g.FillRectangle($black, $x, $btnY + $btn - 1, $btn, 1)
        $g.FillRectangle($black, $x + $btn - 1, $btnY, 1, $btn)
        if ($s -ge 48) {
          $penWidth = [Math]::Max(1, [int][Math]::Round($s * 0.012))
          $glyph = New-Object System.Drawing.Pen([System.Drawing.Color]::Black, $penWidth)
          $pens += $glyph
          $midX = $x + [int][Math]::Floor($btn / 2)
          switch ($i) {
            0 { $g.DrawLine($glyph, $x + 1, $btnY + $btn - 2, $x + $btn - 2, $btnY + $btn - 2) }           # minimize
            1 { $g.DrawRectangle($glyph, $x + 1, $btnY + 1, $btn - 3, $btn - 3) }                            # maximize
            2 {
              $g.DrawLine($glyph, $x + 1, $btnY + 1, $x + $btn - 2, $btnY + $btn - 2)                       # close
              $g.DrawLine($glyph, $x + $btn - 2, $btnY + 1, $x + 1, $btnY + $btn - 2)
            }
          }
        }
        $x = $x - $gap
      }
    }

    # Sunken client area.
    $clientX = $frame
    $clientY = $frame + $titleH
    $clientW = $frameW
    $clientH = $s - $clientY - $frame
    if ($clientH -ge 3 -and $clientW -ge 3) {
      $g.FillRectangle($white, $clientX, $clientY, $clientW, $clientH)
      # Sunken edge: dark on top/left, light gray on bottom/right.
      $g.FillRectangle($dark, $clientX, $clientY, $clientW, 1)
      $g.FillRectangle($dark, $clientX, $clientY, 1, $clientH)
      $g.FillRectangle($gray, $clientX, $clientY + $clientH - 1, $clientW, 1)
      $g.FillRectangle($gray, $clientX + $clientW - 1, $clientY, 1, $clientH)

      # The falling-word mark: a bold "W" centered in the client area.
      $fontPx = [Math]::Max(7, [int][Math]::Round($s * 0.30))
      $text = 'W'
      try {
        $font = New-Object System.Drawing.Font('Arial Black', [single]$fontPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      } catch {
        $font = New-Object System.Drawing.Font('Arial', [single]$fontPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
      }
      $sf = New-Object System.Drawing.StringFormat
      $sf.Alignment = [System.Drawing.StringAlignment]::Center
      $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
      $sf.FormatFlags = [System.Drawing.StringFormatFlags]::NoClip
      $rect = New-Object System.Drawing.RectangleF([single]$clientX, [single]$clientY, [single]$clientW, [single]$clientH)
      # Drop shadow then the letter itself.
      $shadowRect = New-Object System.Drawing.RectangleF([single]($clientX + 1), [single]($clientY + 1), [single]$clientW, [single]$clientH)
      $g.DrawString($text, $font, $navyInk, $shadowRect, $sf)
      $g.DrawString($text, $font, $navy, $rect, $sf)
      $font.Dispose()
      $sf.Dispose()
    }
  } finally {
    foreach ($p in $pens) { $p.Dispose() }
    $gray.Dispose(); $white.Dispose(); $dark.Dispose(); $black.Dispose(); $navy.Dispose(); $navyInk.Dispose()
    $g.Dispose()
  }

  return $bmp
}

# Build PNG entries.
$entries = @()
foreach ($size in $sizes) {
  $bmp = Draw-Mark $size
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $entries += [pscustomobject]@{ Size = $size; Png = $ms.ToArray() }
  $ms.Dispose()
  $bmp.Dispose()
}

# Assemble the ICO container (PNG-compressed entries).
$parent = Split-Path -Parent $OutPath
if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }

$fs = [System.IO.File]::Create($OutPath)
$bw = New-Object System.IO.BinaryWriter($fs)
try {
  $bw.Write([UInt16]0)               # reserved
  $bw.Write([UInt16]1)               # type: icon
  $bw.Write([UInt16]$entries.Count)  # image count

  $offset = 6 + 16 * $entries.Count
  foreach ($e in $entries) {
    $dim = if ($e.Size -ge 256) { 0 } else { $e.Size }
    $bw.Write([byte]$dim)
    $bw.Write([byte]$dim)
    $bw.Write([byte]0)               # palette colors
    $bw.Write([byte]0)               # reserved
    $bw.Write([UInt16]1)             # color planes
    $bw.Write([UInt16]32)            # bits per pixel
    $bw.Write([UInt32]$e.Png.Length)
    $bw.Write([UInt32]$offset)
    $offset += $e.Png.Length
  }
  foreach ($e in $entries) { $bw.Write($e.Png) }
} finally {
  $bw.Dispose()
  $fs.Dispose()
}

$info = Get-Item $OutPath
Write-Host "Wrote $($info.FullName) ($($info.Length) bytes; sizes: $($sizes -join '/'))"
