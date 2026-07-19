# Generates Postman-style NSIS bitmaps (24-bit BMP) for electron-builder.
# Outputs under build/installer/. Re-run after swapping public/logo.png.
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Drawing.Drawing2D

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "build\installer"
$logoPath = Join-Path $root "public\logo.png"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

function New-Bmp24([int]$w, [int]$h) {
  New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
}

function Paint-Hero([System.Drawing.Bitmap]$bmp, [bool]$finish) {
  $w = $bmp.Width
  $h = $bmp.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $c0 = [System.Drawing.Color]::FromArgb(255, 18, 10, 36)
  $c1 = [System.Drawing.Color]::FromArgb(255, 79, 40, 160)
  $c2 = if ($finish) {
    [System.Drawing.Color]::FromArgb(255, 56, 180, 140)
  } else {
    [System.Drawing.Color]::FromArgb(255, 192, 48, 180)
  }
  $c3 = if ($finish) {
    [System.Drawing.Color]::FromArgb(255, 120, 220, 190)
  } else {
    [System.Drawing.Color]::FromArgb(255, 255, 122, 69)
  }

  $rect = New-Object System.Drawing.Rectangle 0, 0, $w, $h
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $w, $h),
    $c0,
    $c3
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = @($c0, $c1, $c2, $c3)
  $blend.Positions = @([float]0.0, [float]0.35, [float]0.7, [float]1.0)
  $brush.InterpolationColors = $blend
  $g.FillRectangle($brush, $rect)
  $brush.Dispose()

  $orb1 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(55, 255, 255, 255))
  $orb2 = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(45, 255, 180, 80))
  $g.FillEllipse($orb1, [int]($w * 0.5), [int]($h * 0.05), [int]($w * 0.7), [int]($w * 0.7))
  $g.FillEllipse($orb2, [int](-$w * 0.25), [int]($h * 0.55), [int]($w * 0.85), [int]($w * 0.85))
  $orb1.Dispose()
  $orb2.Dispose()

  if (Test-Path $logoPath) {
    $logo = [System.Drawing.Image]::FromFile($logoPath)
    $logoSize = [Math]::Min([int]($w * 0.42), 72)
    $lx = [int](($w - $logoSize) / 2)
    $ly = [int]($h * 0.38 - $logoSize / 2)
    $plate = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
    $pad = 10
    $g.FillEllipse($plate, $lx - $pad, $ly - $pad, $logoSize + 2 * $pad, $logoSize + 2 * $pad)
    $plate.Dispose()
    $g.DrawImage($logo, $lx, $ly, $logoSize, $logoSize)
    $logo.Dispose()
  }

  $barColor = if ($finish) {
    [System.Drawing.Color]::FromArgb(200, 80, 210, 160)
  } else {
    [System.Drawing.Color]::FromArgb(200, 255, 122, 69)
  }
  $bar = New-Object System.Drawing.SolidBrush $barColor
  $g.FillRectangle($bar, 0, $h - 8, $w, 8)
  $bar.Dispose()
  $g.Dispose()
}

function Paint-Header([System.Drawing.Bitmap]$bmp) {
  $w = $bmp.Width
  $h = $bmp.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $c0 = [System.Drawing.Color]::FromArgb(255, 32, 18, 64)
  $c1 = [System.Drawing.Color]::FromArgb(255, 103, 80, 164)
  $c2 = [System.Drawing.Color]::FromArgb(255, 230, 90, 140)
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $w, 0),
    $c0,
    $c2
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = @($c0, $c1, $c2)
  $blend.Positions = @([float]0.0, [float]0.5, [float]1.0)
  $brush.InterpolationColors = $blend
  $g.FillRectangle($brush, 0, 0, $w, $h)
  $brush.Dispose()
  if (Test-Path $logoPath) {
    $logo = [System.Drawing.Image]::FromFile($logoPath)
    $size = [Math]::Min($h - 10, 40)
    $g.DrawImage($logo, 8, [int](($h - $size) / 2), $size, $size)
    $logo.Dispose()
  }
  $g.Dispose()
}

function Save-Bmp([System.Drawing.Bitmap]$bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Bmp)
}

function Save-Png([System.Drawing.Bitmap]$bmp, [string]$path) {
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
}

$welcome = New-Bmp24 164 314
Paint-Hero $welcome $false
Save-Bmp $welcome (Join-Path $outDir "welcome.bmp")
Save-Bmp $welcome (Join-Path $outDir "installerSidebar.bmp")
$welcome2x = New-Bmp24 328 628
Paint-Hero $welcome2x $false
Save-Png $welcome2x (Join-Path $outDir "welcome@2x.png")
$welcome.Dispose(); $welcome2x.Dispose()

$finish = New-Bmp24 164 314
Paint-Hero $finish $true
Save-Bmp $finish (Join-Path $outDir "finish.bmp")
Save-Bmp $finish (Join-Path $outDir "uninstallerSidebar.bmp")
$finish2x = New-Bmp24 328 628
Paint-Hero $finish2x $true
Save-Png $finish2x (Join-Path $outDir "finish@2x.png")
$finish.Dispose(); $finish2x.Dispose()

$header = New-Bmp24 150 57
Paint-Header $header
Save-Bmp $header (Join-Path $outDir "header.bmp")
$header2x = New-Bmp24 300 114
Paint-Header $header2x
Save-Png $header2x (Join-Path $outDir "header@2x.png")
$header.Dispose(); $header2x.Dispose()

Write-Output "Installer art written to $outDir"
Get-ChildItem $outDir -File | ForEach-Object { Write-Output ("  {0} ({1} bytes)" -f $_.Name, $_.Length) }
