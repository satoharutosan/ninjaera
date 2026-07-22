# Build multi-resolution Windows .ico from build/icon.png for electron-builder.
# Include Win10/11 taskbar DPI sizes (20, 40) so the shell never falls back to a generic glyph.
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "build\icon.png"
$outIco = Join-Path $root "build\icon.ico"
& (Join-Path $PSScriptRoot "png-to-ico.ps1") -SrcPng $src -OutIco $outIco -Sizes @(16, 20, 24, 32, 40, 48, 64, 128, 256)
