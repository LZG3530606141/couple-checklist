$ErrorActionPreference = 'Stop'
$taskNode = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $taskNode) {
    $taskNode = 'C:\Users\HP\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\node.exe'
}
if (-not (Test-Path -LiteralPath $taskNode)) { throw 'Node.js was not found.' }
$taskPort = if ($env:PORT) { [int]$env:PORT } else { 8765 }
$taskListener = Get-NetTCPConnection -State Listen -LocalPort $taskPort -ErrorAction SilentlyContinue
if ($taskListener) {
    Write-Output "Port $taskPort is already in use. The existing process was left untouched."
    Write-Output 'Set $env:PORT to another port before running this script.'
    exit 1
}
$taskServer = Join-Path $PSScriptRoot 'server.mjs'
$taskProcess = Start-Process -FilePath $taskNode -ArgumentList @('"' + $taskServer + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'server.log') -RedirectStandardError (Join-Path $PSScriptRoot 'server.error.log')
Write-Output "Started process $($taskProcess.Id). Open server.log for the private invitation URLs."
