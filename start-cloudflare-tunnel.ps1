$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$taskCloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$taskPort = 8765
$taskOut = Join-Path $taskRoot 'cloudflared.log'
$taskErr = Join-Path $taskRoot 'cloudflared.error.log'
$taskTokenFile = Join-Path $taskRoot 'data\access-key.txt'

if (-not (Test-Path -LiteralPath $taskCloudflared)) { throw 'Cloudflared is not installed.' }
if (-not (Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue)) {
    $taskStartScript = Join-Path $taskRoot 'start.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $taskStartScript
    Start-Sleep -Seconds 1
}

$taskExisting = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'cloudflared.exe' -and $_.CommandLine -match 'localhost:8765' }
if (-not $taskExisting) {
    $null = Start-Process -FilePath $taskCloudflared -ArgumentList @('tunnel', '--url', 'http://localhost:8765', '--no-autoupdate') -WorkingDirectory $taskRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput $taskOut -RedirectStandardError $taskErr
}

$taskUrl = $null
for ($taskAttempt = 0; $taskAttempt -lt 25; $taskAttempt++) {
    $taskText = ((Get-Content -LiteralPath $taskOut -ErrorAction SilentlyContinue) + (Get-Content -LiteralPath $taskErr -ErrorAction SilentlyContinue)) -join "`n"
    $taskMatch = [regex]::Match($taskText, 'https://[a-z0-9-]+\.trycloudflare\.com')
    if ($taskMatch.Success) { $taskUrl = $taskMatch.Value; break }
    Start-Sleep -Milliseconds 500
}
if (-not $taskUrl) { throw "Could not obtain a temporary public URL. See $taskErr" }

$taskToken = (Get-Content -LiteralPath $taskTokenFile).Trim()
$taskInvite = "$taskUrl/?as=b#$taskToken"
Set-Clipboard -Value $taskInvite
Write-Host ''
Write-Host 'The public checklist URL has been copied to the clipboard:' -ForegroundColor Green
Write-Host $taskInvite -ForegroundColor Cyan
Write-Host ''
Write-Host 'This temporary URL may expire after shutdown, restart, or tunnel termination. Run the desktop shortcut again when needed.'
