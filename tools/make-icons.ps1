# Génère les icônes PNG et ICO de Folio à partir du dessin du logo (icons/logo.svg).
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'icons'

function New-Logo([int]$size, [bool]$maskable) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'AntiAlias'; $g.PixelOffsetMode = 'HighQuality'
  $bg = [System.Drawing.Color]::FromArgb(255, 0x2E, 0x30, 0x35)
  $amber = [System.Drawing.Color]::FromArgb(255, 0xF5, 0xA6, 0x23)
  if ($maskable) { $g.Clear($bg); $k = $size / 1024 * 0.8; $off = $size * 0.1 }
  else {
    $k = $size / 1024; $off = 0
    $r = 224 * $k * 2
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $p.AddArc(0, 0, $r, $r, 180, 90); $p.AddArc($size - $r, 0, $r, $r, 270, 90)
    $p.AddArc($size - $r, $size - $r, $r, $r, 0, 90); $p.AddArc(0, $size - $r, $r, $r, 90, 90); $p.CloseFigure()
    $g.FillPath((New-Object System.Drawing.SolidBrush $bg), $p)
  }
  $pen = New-Object System.Drawing.Pen $amber, ([single](60 * $k))
  $pen.StartCap = 'Round'; $pen.EndCap = 'Round'; $pen.LineJoin = 'Round'
  $P = { param($x, $y) New-Object System.Drawing.PointF ([single]($x * $k + $off)), ([single]($y * $k + $off)) }
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((& $P 748 520), (& $P 748 392), (& $P 592 236), (& $P 300 236), (& $P 300 788), (& $P 508 788)))
  $g.DrawLines($pen, [System.Drawing.PointF[]]@((& $P 592 236), (& $P 592 392), (& $P 748 392)))
  $g.DrawBeziers($pen, [System.Drawing.PointF[]]@((& $P 420 640), (& $P 460 570), (& $P 500 570), (& $P 520 640), (& $P 540 710), (& $P 590 700), (& $P 630 630), (& $P 670 560), (& $P 690 590), (& $P 720 670)))
  $g.Dispose()
  return $bmp
}

function Save-Png($bmp, $name) { $bmp.Save((Join-Path $out $name), [System.Drawing.Imaging.ImageFormat]::Png) }

Save-Png (New-Logo 192 $false) 'icon-192.png'
Save-Png (New-Logo 512 $false) 'icon-512.png'
Save-Png (New-Logo 512 $true) 'icon-maskable-512.png'

# Fichier .ico (16, 32, 48, 256 px, images PNG intégrées)
$sizes = 16, 32, 48, 256
$pngs = foreach ($s in $sizes) { $ms = New-Object IO.MemoryStream; (New-Logo $s $false).Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); ,$ms.ToArray() }
$fs = [IO.File]::Create((Join-Path $out 'folio.ico'))
$w = New-Object IO.BinaryWriter $fs
$w.Write([UInt16]0); $w.Write([UInt16]1); $w.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $d = $pngs[$i]
  $b = if ($s -ge 256) { 0 } else { $s }
  $w.Write([byte]$b); $w.Write([byte]$b); $w.Write([byte]0); $w.Write([byte]0)
  $w.Write([UInt16]1); $w.Write([UInt16]32); $w.Write([UInt32]$d.Length); $w.Write([UInt32]$offset)
  $offset += $d.Length
}
foreach ($d in $pngs) { $w.Write($d) }
$w.Close()
Write-Host 'Icones generees.'
