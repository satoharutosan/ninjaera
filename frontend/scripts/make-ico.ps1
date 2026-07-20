# Build multi-resolution Windows .ico from build/icon.png for electron-builder.
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "build\icon.png"
$outIco = Join-Path $root "build\icon.ico"
& (Join-Path $PSScriptRoot "png-to-ico.ps1") -SrcPng $src -OutIco $outIco -Sizes @(16, 24, 32, 48, 64, 128, 256)
