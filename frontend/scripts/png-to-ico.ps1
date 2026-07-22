# Pack a PNG into a multi-resolution Windows .ico (PNG-compressed frames).
param(
  [Parameter(Mandatory = $true)][string]$SrcPng,
  [Parameter(Mandatory = $true)][string]$OutIco,
  [int[]]$Sizes = @(16, 20, 24, 32, 48, 64, 128, 256)
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path $SrcPng)) { throw "Missing source PNG: $SrcPng" }
$outDir = Split-Path -Parent $OutIco
if ($outDir) { New-Item -ItemType Directory -Force -Path $outDir | Out-Null }

$srcImg = [System.Drawing.Image]::FromFile((Resolve-Path $SrcPng))
$frames = New-Object System.Collections.Generic.List[byte[]]

foreach ($size in $Sizes) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcImg, 0, 0, $size, $size)
  $g.Dispose()
  $pngMs = New-Object System.IO.MemoryStream
  $bmp.Save($pngMs, [System.Drawing.Imaging.ImageFormat]::Png)
  $frames.Add($pngMs.ToArray())
  $pngMs.Dispose()
  $bmp.Dispose()
}
$srcImg.Dispose()

$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter $ms
$bw.Write([uint16]0)
$bw.Write([uint16]1)
$bw.Write([uint16]$frames.Count)
$offset = 6 + (16 * $frames.Count)
for ($i = 0; $i -lt $frames.Count; $i++) {
  $size = $Sizes[$i]
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
$bytes = $ms.ToArray()
$bw.Dispose()
$ms.Dispose()

# Atomic replace — avoids "user-mapped section" / locked icon.ico failures on Windows.
$tmp = "$OutIco.new"
[System.IO.File]::WriteAllBytes($tmp, $bytes)
if (Test-Path $OutIco) {
  [System.IO.File]::Delete($OutIco)
}
[System.IO.File]::Move($tmp, $OutIco)
Write-Output "Wrote $OutIco ($((Get-Item $OutIco).Length) bytes) from $SrcPng"
