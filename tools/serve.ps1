# Petit serveur local pour Folio (aucune installation requise).
# Usage : powershell -ExecutionPolicy Bypass -File tools\serve.ps1 [-Port 8765] [-NoBrowser]
param(
  [int]$Port = 8765,
  [switch]$NoBrowser
)

$root = Split-Path -Parent $PSScriptRoot
$prefix = "http://localhost:$Port/"
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json'
  '.webmanifest' = 'application/manifest+json'; '.svg' = 'image/svg+xml'
  '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.ico' = 'image/x-icon'
  '.pdf' = 'application/pdf'; '.woff2' = 'font/woff2'; '.ttf' = 'font/ttf'
  '.bcmap' = 'application/octet-stream'; '.pfb' = 'application/octet-stream'
  '.wasm' = 'application/wasm'; '.txt' = 'text/plain; charset=utf-8'
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)
try { $listener.Start() } catch {
  Write-Host "Le port $Port est deja utilise : Folio tourne peut-etre deja." -ForegroundColor Yellow
  if (-not $NoBrowser) { Start-Process "msedge.exe" "--app=$prefix" -ErrorAction SilentlyContinue }
  exit 0
}
Write-Host "Folio est servi sur $prefix  (Ctrl+C pour arreter)" -ForegroundColor Green

if (-not $NoBrowser) {
  try { Start-Process "msedge.exe" "--app=$prefix" -ErrorAction Stop }
  catch { Start-Process $prefix }
}

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $req = $ctx.Request; $res = $ctx.Response
  try {
    $path = [Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
    if ($path -eq '') { $path = 'index.html' }
    $full = [IO.Path]::GetFullPath((Join-Path $root $path))
    if (-not $full.StartsWith($root) -or -not (Test-Path $full -PathType Leaf)) {
      $res.StatusCode = 404
      $b = [Text.Encoding]::UTF8.GetBytes('404')
      $res.OutputStream.Write($b, 0, $b.Length)
    } else {
      $ext = [IO.Path]::GetExtension($full).ToLower()
      $res.ContentType = if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' }
      $res.Headers.Add('Cache-Control', 'no-cache')
      $bytes = [IO.File]::ReadAllBytes($full)
      $res.ContentLength64 = $bytes.Length
      $res.OutputStream.Write($bytes, 0, $bytes.Length)
    }
  } catch { try { $res.StatusCode = 500 } catch {} }
  finally { try { $res.OutputStream.Close() } catch {} }
}
