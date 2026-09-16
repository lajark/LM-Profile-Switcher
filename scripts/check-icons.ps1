param([switch]$Preview)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class LmpsIconNative {
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern IntPtr LoadImageW(IntPtr instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll")] public static extern bool DestroyIcon(IntPtr icon);
}
"@
$iconRoot = Join-Path $PSScriptRoot '../apps/desktop/src-tauri/icons'
$sizes = @(16,20,24,32,48,64,128,256)
$rows = @()
foreach ($variant in @('app','mono-dark','mono-light')) {
    foreach ($size in $sizes) {
        $bitmap = [Drawing.Bitmap]::new((Join-Path $iconRoot "$variant-$size.png"))
        try {
            if ($bitmap.Width -ne $size -or $bitmap.Height -ne $size) { throw "Bad dimensions: $variant-$size" }
            $clear = 0; $solid = 0; $partial = 0
            for ($y = 0; $y -lt $size; $y++) {
                for ($x = 0; $x -lt $size; $x++) {
                    $alpha = $bitmap.GetPixel($x,$y).A
                    if ($alpha -eq 0) { $clear++ } elseif ($alpha -eq 255) { $solid++ } else { $partial++ }
                    if (($x -eq 0 -or $y -eq 0 -or $x -eq $size-1 -or $y -eq $size-1) -and $alpha -ne 0) {
                        throw "Clipped transparent margin: $variant-$size"
                    }
                }
            }
            if ($clear -eq 0 -or $solid -eq 0 -or $partial -eq 0) { throw "Missing alpha coverage: $variant-$size" }
            $rows += [pscustomobject]@{Variant=$variant; Size=$size; Clear=$clear; Solid=$solid; Antialiased=$partial}
        } finally { $bitmap.Dispose() }
    }
}
foreach ($size in $sizes) {
    $nativeHandle = [LmpsIconNative]::LoadImageW([IntPtr]::Zero, (Join-Path $iconRoot 'icon.ico'), 1, $size, $size, 16)
    if ($nativeHandle -eq [IntPtr]::Zero) { throw "Windows ICO load failed: $size" }
    $native = [Drawing.Icon]::FromHandle($nativeHandle)
    try {
        if ($native.Width -ne $size -or $native.Height -ne $size) { throw "Windows ICO size unavailable: $size" }
    } finally { $native.Dispose(); [LmpsIconNative]::DestroyIcon($nativeHandle) | Out-Null }
}
Write-Output 'PASS: 24 PNGs decoded; all transparent borders, solid interiors and antialiased edges verified; Windows decoded all 8 ICO sizes.'
if ($Preview) {
    $output = Join-Path $PSScriptRoot '../.workspace/tmp/icon-family'
    [IO.Directory]::CreateDirectory($output) | Out-Null
    $rows | ConvertTo-Json | Set-Content (Join-Path $output 'alpha-report.json') -Encoding utf8
    $sheet = [Drawing.Bitmap]::new(1120,1130)
    $g = [Drawing.Graphics]::FromImage($sheet)
    $font = [Drawing.Font]::new('Segoe UI',11)
    $heading = [Drawing.Font]::new('Segoe UI',18,[Drawing.FontStyle]::Bold)
    try {
        $g.Clear([Drawing.ColorTranslator]::FromHtml('#F7F8FA'))
        $g.DrawString('LM Profile Switcher / Sliding Models',$heading,[Drawing.Brushes]::Black,24,18)
        $g.DrawString('Offline resource review — original vector, no third-party artwork',$font,[Drawing.Brushes]::DimGray,24,54)
        $app = [Drawing.Bitmap]::new((Join-Path $iconRoot 'app-256.png'))
        $g.FillRectangle([Drawing.Brushes]::White,24,90,300,280)
        $g.FillRectangle([Drawing.Brushes]::Black,344,90,300,280)
        $g.DrawImageUnscaled($app,46,102)
        $g.DrawImageUnscaled($app,366,102)
        $app.Dispose()
        $g.DrawString('Two model cards / one explicit switch',$font,[Drawing.Brushes]::Black,680,128)
        $g.DrawString('100% = 16px; 125% = 20px; 150% = 24px',$font,[Drawing.Brushes]::Black,680,160)
        $g.DrawString('Blue = product identity, not runtime status',$font,[Drawing.Brushes]::Black,680,192)
        $g.DrawString('Below: native-size samples, no upscaling',$font,[Drawing.Brushes]::Black,680,224)
        $g.DrawString('OS taskbar / tray acceptance still separate',$font,[Drawing.Brushes]::Black,680,256)
        $displaySizes = @(16,20,24,32,48,64,128)
        $panels = @(
            @{Name='Accent / light'; Variant='app'; Bg='#FFFFFF'; Fg='#171A21'},
            @{Name='Accent / dark'; Variant='app'; Bg='#15171B'; Fg='#F3F5F8'},
            @{Name='Monochrome / light'; Variant='mono-dark'; Bg='#FFFFFF'; Fg='#171A21'},
            @{Name='Reverse / dark'; Variant='mono-light'; Bg='#15171B'; Fg='#F3F5F8'}
        )
        for ($i=0; $i -lt $panels.Count; $i++) {
            $panel=$panels[$i]; $top=390+$i*180
            $bg=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($panel.Bg))
            $fg=[Drawing.SolidBrush]::new([Drawing.ColorTranslator]::FromHtml($panel.Fg))
            $g.FillRectangle($bg,24,$top,1072,176)
            $g.DrawString($panel.Name,$font,$fg,36,$top+10)
            for ($j=0; $j -lt $displaySizes.Count; $j++) {
                $size=$displaySizes[$j]; $left=238+$j*110

                $bitmap=[Drawing.Bitmap]::new((Join-Path $iconRoot "$($panel.Variant)-$size.png"))
                $g.DrawImageUnscaled($bitmap,$left,$top+24)
                $g.DrawString([string]$size,$font,$fg,$left,$top+152)
                $bitmap.Dispose()
            }
            $bg.Dispose(); $fg.Dispose()
        }
        $sheet.Save((Join-Path $output 'review.png'),[Drawing.Imaging.ImageFormat]::Png)
    } finally { $heading.Dispose(); $font.Dispose(); $g.Dispose(); $sheet.Dispose() }
    Write-Output 'Preview: .workspace/tmp/icon-family/review.png; alpha-report.json'
}
