# Creates build/install-spinner.gif — shown by Squirrel.Windows Setup.exe during install.
# Replaces the default squirrel animation with Ninja Era / Soft Future branding.
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root "build"
$outGif = Join-Path $outDir "install-spinner.gif"
$logoPath = Join-Path $root "public\logo.png"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

$w = 640
$h = 400
$frames = 12
$bmpList = New-Object System.Collections.Generic.List[System.Drawing.Bitmap]

for ($i = 0; $i -lt $frames; $i++) {
  $bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic

  $phase = $i / [double]$frames
  $c0 = [System.Drawing.Color]::FromArgb(255, 18, 10, 36)
  $c1 = [System.Drawing.Color]::FromArgb(255, 79, 40, 160)
  $c2 = [System.Drawing.Color]::FromArgb(255, 192, 48, 180)
  $c3 = [System.Drawing.Color]::FromArgb(255, 255, 122, 69)

  $x2 = [int]($w * (0.7 + 0.3 * [Math]::Sin(2 * [Math]::PI * $phase)))
  $y2 = [int]($h * (0.3 + 0.2 * [Math]::Cos(2 * [Math]::PI * $phase)))
  $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush (
    (New-Object System.Drawing.Point 0, 0),
    (New-Object System.Drawing.Point $x2, $y2),
    $c0,
    $c3
  )
  $blend = New-Object System.Drawing.Drawing2D.ColorBlend
  $blend.Colors = @($c0, $c1, $c2, $c3)
  $blend.Positions = @([float]0.0, [float]0.35, [float]0.7, [float]1.0)
  $brush.InterpolationColors = $blend
  $g.FillRectangle($brush, 0, 0, $w, $h)
  $brush.Dispose()

  # Orbiting accent orbs
  $ox = [int]($w * 0.5 + [Math]::Cos(2 * [Math]::PI * $phase) * $w * 0.22)
  $oy = [int]($h * 0.45 + [Math]::Sin(2 * [Math]::PI * $phase) * $h * 0.18)
  $orb = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(70, 255, 255, 255))
  $g.FillEllipse($orb, $ox - 40, $oy - 40, 80, 80)
  $orb.Dispose()

  if (Test-Path $logoPath) {
    $logo = [System.Drawing.Image]::FromFile($logoPath)
    $logoSize = 96
    $lx = [int](($w - $logoSize) / 2)
    $ly = [int](($h - $logoSize) / 2) - 24
    $plate = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(80, 255, 255, 255))
    $g.FillEllipse($plate, $lx - 16, $ly - 16, $logoSize + 32, $logoSize + 32)
    $plate.Dispose()
    $g.DrawImage($logo, $lx, $ly, $logoSize, $logoSize)
    $logo.Dispose()
  }

  $font = New-Object System.Drawing.Font "Segoe UI", 18, ([System.Drawing.FontStyle]::Bold)
  $sf = New-Object System.Drawing.StringFormat
  $sf.Alignment = [System.Drawing.StringAlignment]::Center
  $textBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 237, 231, 246))
  $g.DrawString("Ninja Era Messenger", $font, $textBrush, (New-Object System.Drawing.RectangleF 0, ($h - 88), $w, 32), $sf)
  $font2 = New-Object System.Drawing.Font "Segoe UI", 11
  $muted = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(220, 200, 190, 220))
  $g.DrawString("Installing… Soft Future", $font2, $muted, (New-Object System.Drawing.RectangleF 0, ($h - 52), $w, 28), $sf)
  $font.Dispose(); $font2.Dispose(); $textBrush.Dispose(); $muted.Dispose(); $sf.Dispose()

  # Progress dots
  for ($d = 0; $d -lt 5; $d++) {
    $active = (($i + $d) % 5) -lt 2
    $alpha = if ($active) { 230 } else { 80 }
    $dot = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb($alpha, 255, 122, 69))
    $dx = [int]($w / 2 - 40 + $d * 20)
    $g.FillEllipse($dot, $dx, $h - 22, 8, 8)
    $dot.Dispose()
  }

  $g.Dispose()
  $bmpList.Add($bmp)
}

# Encode animated GIF via .NET GIF encoder
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq "image/gif" }
$encoder = [System.Drawing.Imaging.Encoder]::SaveFlag
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1

$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::MultiFrame)
$bmpList[0].Save($outGif, $codec, $ep)

$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::FrameDimensionTime)
for ($i = 1; $i -lt $bmpList.Count; $i++) {
  $bmpList[0].SaveAdd($bmpList[$i], $ep)
}
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter $encoder, ([long][System.Drawing.Imaging.EncoderValue]::Flush)
$bmpList[0].SaveAdd($ep)

foreach ($b in $bmpList) { $b.Dispose() }
Write-Output "Wrote $outGif ($((Get-Item $outGif).Length) bytes)"
