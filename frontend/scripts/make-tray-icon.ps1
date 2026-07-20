# Pack build/tray-icon.png into a multi-resolution tray-icon.ico (does not rewrite the PNG).
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root "build\tray-icon.png"
$outIco = Join-Path $root "build\tray-icon.ico"
& (Join-Path $PSScriptRoot "png-to-ico.ps1") -SrcPng $src -OutIco $outIco -Sizes @(16, 20, 24, 32, 40, 48, 64, 128, 256)
