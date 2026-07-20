# Build a white (Telegram-style) multi-resolution tray .ico from public/logo.png.
# Does NOT replace build/icon.ico (window / EXE / installer icons stay unchanged).
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "public\logo.png"
$outDir = Join-Path $root "build"
$outPng = Join-Path $outDir "tray-icon.png"
$outIco = Join-Path $outDir "tray-icon.ico"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

if (-not (Test-Path $src)) {
  throw "Missing source logo: $src"
}

function New-WhiteSilhouette([System.Drawing.Bitmap]$srcBmp) {
  $w = $srcBmp.Width
  $h = $srcBmp.Height
  $dst = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

  # Sample corner average as background (logo sits on near-black).
  $corners = @(
    $srcBmp.GetPixel(0, 0),
    $srcBmp.GetPixel($w - 1, 0),
    $srcBmp.GetPixel(0, $h - 1),
    $srcBmp.GetPixel($w - 1, $h - 1)
  )
  $bgR = 0; $bgG = 0; $bgB = 0
  foreach ($c in $corners) {
    $bgR += [int]$c.R
    $bgG += [int]$c.G
    $bgB += [int]$c.B
  }
  $bgR = [int]($bgR / 4)
  $bgG = [int]($bgG / 4)
  $bgB = [int]($bgB / 4)

  for ($y = 0; $y -lt $h; $y++) {
    for ($x = 0; $x -lt $w; $x++) {
      $p = $srcBmp.GetPixel($x, $y)
      $dr = [Math]::Abs([int]$p.R - $bgR)
      $dg = [Math]::Abs([int]$p.G - $bgG)
      $db = [Math]::Abs([int]$p.B - $bgB)
      $dist = [Math]::Max($dr, [Math]::Max($dg, $db))
      $lum = [int](0.299 * $p.R + 0.587 * $p.G + 0.114 * $p.B)

      # Content = brighter than black bg OR materially different from corner bg.
      # Soft edge: map distance/luma into alpha for crisp small sizes.
      $score = [Math]::Max($dist, [int]($lum * 0.85))
      if ($score -lt 18) {
        $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
        continue
      }

      # Near-pure white fill; alpha from how solid the pixel is.
      $alpha = [Math]::Min(255, [int](($score - 12) * 3.2))
      if ($alpha -lt 40) {
        $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb(0, 0, 0, 0))
      } else {
        $dst.SetPixel($x, $y, [System.Drawing.Color]::FromArgb($alpha, 255, 255, 255))
      }
    }
  }
  return $dst
}

function Resize-HighQuality([System.Drawing.Bitmap]$srcBmp, [int]$size) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  # Slight inset so blades don't clip at 16px.
  $pad = [Math]::Max(1, [int][Math]::Round($size * 0.06))
  $g.DrawImage($srcBmp, $pad, $pad, $size - 2 * $pad, $size - 2 * $pad)
  $g.Dispose()
  return $bmp
}

function Get-PngBytes([System.Drawing.Bitmap]$bmp) {
  $pngMs = New-Object System.IO.MemoryStream
  $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
  $bytes = $pngMs.ToArray()
  $pngMs.Dispose()
  return $bytes
}

$srcImg = [System.Drawing.Bitmap]::FromFile($src)
$silhouette = New-WhiteSilhouette $srcImg
$srcImg.Dispose()

# Master PNG (256) for packaging / inspection.
$master = Resize-HighQuality $silhouette 256
$master.Save($outPng, [System.Drawing.Imaging.ImageFormat]::Png)

# Windows tray common sizes + a few larger for DPI.
$sizes = @(16, 20, 24, 32, 40, 48, 64, 128, 256)
$frames = New-Object System.Collections.Generic.List[byte[]]

foreach ($size in $sizes) {
  $frameBmp = Resize-HighQuality $silhouette $size
  $frames.Add((Get-PngBytes $frameBmp))
  $frameBmp.Dispose()
}

$master.Dispose()
$silhouette.Dispose()

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
for ($i = 0; $i -lt $frames.Count; $i++) {
  $size = $sizes[$i]
  $data = $frames[$i]
  $dim = if ($size -ge 256) { [byte]0 } else { [byte]$size }
  $bw.Write($dim)
  $bw.Write($dim)
  $bw.Write([byte]0)
  $bw.Write([byte]0)
  $bw.Write([uint16]1)
  $bw.Write([uint16]32)
  $bw.Write([uint32]$data.Length)
  $bw.Write([uint32]$offset)
  $offset += $data.Length
}
foreach ($data in $frames) { $bw.Write($data) }
$bw.Flush()
[System.IO.File]::WriteAllBytes($outIco, $ms.ToArray())
$bw.Dispose()
$ms.Dispose()

Write-Output "Wrote $outPng ($((Get-Item $outPng).Length) bytes)"
Write-Output "Wrote $outIco ($((Get-Item $outIco).Length) bytes)"
