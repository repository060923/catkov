#requires -Version 5.1
[CmdletBinding()]
param([switch]$DryRun, [switch]$UseExistingNgrokCredential)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$domain = 'overtame-kadence-noncoincidentally.ngrok-free.dev'
if ($env:OS -ne 'Windows_NT') { throw 'catkov activation requires Windows.' }
$installRoot = Join-Path $env:LOCALAPPDATA 'catkov'
$configPath = Join-Path $installRoot 'install.json'
if ($DryRun) {
    Write-Host "DRY RUN: use only https://$domain/mcp"
    Write-Host 'DRY RUN: require the owning ngrok account credentials, never publish them.'
    Write-Host 'DRY RUN: start ngrok only after previous Mac tunnel is released.'
    return
}
if (-not (Test-Path -LiteralPath $configPath)) {
    throw 'Run scripts/setup-windows.ps1 first.'
}
$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
if ($config.domain -ne $domain) { throw 'Unexpected ngrok domain in install.json.' }
if (-not (Test-Path -LiteralPath $config.ngrok)) { throw 'ngrok executable is missing; rerun setup.' }
$health = Invoke-RestMethod -Uri "http://127.0.0.1:$($config.port)/health" -TimeoutSec 10
if ($health.runtime -ne 'catkov') { throw 'Local runtime is not catkov.' }

if (-not $UseExistingNgrokCredential) {
    Write-Host 'Enter the ngrok authtoken of the account that OWNS the reserved domain.'
    $secure = Read-Host 'ngrok authtoken (hidden)' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
        if ([string]::IsNullOrWhiteSpace($plain)) { throw 'Empty ngrok authtoken.' }
        & $config.ngrok config add-authtoken $plain | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'ngrok credential configuration failed.' }
    } finally {
        if ($ptr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
        $plain = $null
        $secure.Dispose()
    }
} else {
    & $config.ngrok config check | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Existing ngrok configuration is invalid.' }
}
$startup = [Environment]::GetFolderPath('Startup')
$runner = Join-Path $installRoot 'run-ngrok.ps1'
$powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
if (-not (Test-Path -LiteralPath $runner)) { throw 'ngrok launcher missing; rerun setup.' }
$ngrokArgs = 'http ' + [string]$config.port + ' --url https://' + $domain + ' --log stderr'
$ngrokProcess = Start-Process -FilePath $config.ngrok -ArgumentList $ngrokArgs -WindowStyle Hidden -RedirectStandardOutput (Join-Path $installRoot 'ngrok.stdout.log') -RedirectStandardError (Join-Path $installRoot 'ngrok.stderr.log') -PassThru
$verified = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 1
    if ($ngrokProcess.HasExited) { break }
    try {
        $h = Invoke-RestMethod -Uri "https://$domain/health" -TimeoutSec 5
        if ($h.runtime -ne 'catkov') { continue }
        # /health has no OS field; verify the MCP runtime originates on Windows, not the old Mac.
        $rpcBody = @{ jsonrpc='2.0'; id=1; method='tools/call'; params=@{
            name='runtime_context'; arguments=@{}
        }} | ConvertTo-Json -Depth 8 -Compress
        $response = Invoke-WebRequest -UseBasicParsing -Uri "https://$domain/mcp" -Method POST -ContentType 'application/json' -Headers @{ Accept='application/json, text/event-stream' } -Body $rpcBody -TimeoutSec 5
        $data = [string]$response.Content
        $line = ($data -split '\r?\n' | Where-Object { $_ -match '^data: ' } | Select-Object -First 1)
        if ($line) { $data = $line.Substring(6) }
        $result = $data | ConvertFrom-Json
        if ($result.result.structuredContent.runtime -eq 'catkov' -and $result.result.structuredContent.platform -eq 'win32') {
            $verified = $true
            break
        }
    } catch {}
}
if (-not $verified) {
    try { if (-not $ngrokProcess.HasExited) { Stop-Process -Id $ngrokProcess.Id -Force } } catch {}
    throw "Public tunnel did not verify as Windows catkov. Release the Mac tunnel and check $installRoot\ngrok.stderr.log. Autostart was not installed."
}
$shell = New-Object -ComObject WScript.Shell
$link = $shell.CreateShortcut((Join-Path $startup 'catkov-ngrok.lnk'))
$link.TargetPath = $powerShellPath
$link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runner + '"'
$link.WorkingDirectory = $installRoot
$link.WindowStyle = 7
$link.Description = 'catkov reserved ngrok domain tunnel'
$link.Save()
Write-Host "VERIFIED https://$domain/mcp on Windows."
Write-Host 'ngrok tunnel autostart enabled. Register the MCP plugin with Authentication: None.'
