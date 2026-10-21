#requires -Version 5.1
[CmdletBinding()]
param(
    [switch]$DryRun,
    [switch]$LocalOnly,
    [string]$Workspace = ''
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$domain = 'overtame-kadence-noncoincidentally.ngrok-free.dev'
$port = 8791
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$installRoot = Join-Path $env:LOCALAPPDATA 'catkov'
$runtimeRoot = Join-Path $installRoot 'runtime'
$startup = [Environment]::GetFolderPath('Startup')

if ($env:OS -ne 'Windows_NT') { throw 'catkov setup requires Windows 10/11 x64.' }
if ($DryRun) {
    Write-Host "DRY RUN: install from $projectRoot to $runtimeRoot"
    Write-Host "DRY RUN: bind 127.0.0.1:$port, domain $domain"
    Write-Host 'DRY RUN: install Node.js if needed, ngrok if needed, build and verify.'
    Write-Host 'DRY RUN: autostart local MCP only; do not claim the reserved ngrok domain.'
    return
}
if (-not [Environment]::Is64BitOperatingSystem) { throw 'A 64-bit Windows installation is required.' }

function Refresh-Path {
    $machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $env:Path = "$machinePath;$userPath"
}
function Find-Executable([string]$Name) {
    $found = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -ne $found) { return $found.Source }
    return $null
}
function Ensure-Winget {
    if (-not (Find-Executable 'winget.exe')) {
        throw 'winget is required to install missing software. Install Windows App Installer from Microsoft Store and run setup again.'
    }
}
function Ensure-Program([string]$Name, [string[]]$InstallArguments) {
    $found = Find-Executable $Name
    if ($found) { return $found }
    Ensure-Winget
    Write-Host "Installing missing $Name using winget..."
    & winget.exe @InstallArguments
    if ($LASTEXITCODE -ne 0) { throw "winget could not install $Name (exit code $LASTEXITCODE)." }
    Refresh-Path
    $found = Find-Executable $Name
    if (-not $found) { throw "$Name was installed but is unavailable on PATH. Open a new PowerShell window and rerun setup." }
    return $found
}
$node = Ensure-Program 'node.exe' @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
$npm = Ensure-Program 'npm.cmd' @('install','--id','OpenJS.NodeJS.LTS','--exact','--accept-source-agreements','--accept-package-agreements')
$ngrok = ''
if (-not $LocalOnly) {
    $ngrok = Ensure-Program 'ngrok.exe' @('install','ngrok','-s','msstore','--accept-source-agreements','--accept-package-agreements')
}
$nodeMajor = [int](((& $node --version).Trim().TrimStart('v') -split '\.')[0])
if ($nodeMajor -lt 20) { throw "Node.js 20 or newer required; installed version: $(& $node --version)" }

Write-Host 'Checking and building catkov...'
Push-Location $projectRoot
try {
    & $npm ci
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
    & $npm run typecheck
    if ($LASTEXITCODE -ne 0) { throw 'TypeScript typecheck failed.' }
    & $npm test
    if ($LASTEXITCODE -ne 0) { throw 'Windows integration tests failed.' }
    & $npm run build
    if ($LASTEXITCODE -ne 0) { throw 'npm build failed.' }
} finally { Pop-Location }

New-Item -ItemType Directory -Force -Path $runtimeRoot | Out-Null
Copy-Item -Path (Join-Path $projectRoot 'package.json') -Destination $runtimeRoot -Force
Copy-Item -Path (Join-Path $projectRoot 'package-lock.json') -Destination $runtimeRoot -Force
$distTarget = Join-Path $runtimeRoot 'dist'
if (Test-Path $distTarget) { Remove-Item $distTarget -Recurse -Force }
Copy-Item -Path (Join-Path $projectRoot 'dist') -Destination $distTarget -Recurse
& $npm ci --omit=dev --prefix $runtimeRoot
if ($LASTEXITCODE -ne 0) { throw 'Production dependency installation failed.' }

$workspaceRoot = $runtimeRoot
if ($Workspace) {
    $workspaceRoot = (Resolve-Path -LiteralPath $Workspace -ErrorAction Stop).Path
    if (-not (Test-Path -LiteralPath $workspaceRoot -PathType Container)) { throw 'Workspace must be an existing directory.' }
}
# Private local config contains only nonsecret startup paths and options.
$settings = [ordered]@{
    domain = $domain
    port = $port
    node = $node
    ngrok = $ngrok
    runtime = $runtimeRoot
    workspace = $workspaceRoot
}
$settingsPath = Join-Path $installRoot 'install.json'
$settings | ConvertTo-Json | Set-Content -LiteralPath $settingsPath -Encoding UTF8

$runHttp = Join-Path $installRoot 'run-http.ps1'
$runNgrok = Join-Path $installRoot 'run-ngrok.ps1'
@'
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.json') -Raw | ConvertFrom-Json
$env:CATKOV_HOST = '127.0.0.1'
$env:CATKOV_PORT = [string]$config.port
$env:CATKOV_WORKSPACE = [string]$config.workspace
Set-Location -LiteralPath $config.runtime
& $config.node (Join-Path $config.runtime 'dist/src/http.js') *>> (Join-Path $PSScriptRoot 'mcp.log')
'@ | Set-Content -LiteralPath $runHttp -Encoding UTF8
@'
$ErrorActionPreference = 'Stop'
$config = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install.json') -Raw | ConvertFrom-Json
& $config.ngrok http ([string]$config.port) --url ('https://' + $config.domain) --log 'stderr' *>> (Join-Path $PSScriptRoot 'ngrok.log')
'@ | Set-Content -LiteralPath $runNgrok -Encoding UTF8

function Create-StartupLink([string]$LinkName, [string]$TargetScript) {
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path $startup "$LinkName.lnk"))
    $shortcut.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $TargetScript + '"'
    $shortcut.WorkingDirectory = $installRoot
    $shortcut.WindowStyle = 7
    $shortcut.Description = 'catkov MCP Windows runtime'
    $shortcut.Save()
}

Create-StartupLink -LinkName 'catkov-mcp' -TargetScript $runHttp
$powerShellPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$healthy = $false
try {
    $check = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
    if ($check.runtime -eq 'catkov') { $healthy = $true }
    else { throw "TCP port $port is occupied by another service." }
} catch {
    if (($_.Exception.Message -match 'occupied') -or ($_.Exception.Message -match 'another service')) { throw }
}
if (-not $healthy) {
    Start-Process -FilePath $powerShellPath -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $runHttp + '"') -WindowStyle Hidden
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        try {
            $check = Invoke-RestMethod -Uri "http://127.0.0.1:$port/health" -TimeoutSec 2
            if ($check.runtime -eq 'catkov') { $healthy = $true; break }
        } catch {}
    }
}
if (-not $healthy) { throw "Local catkov failed to start. Check $installRoot\mcp.log." }
Write-Host "Local catkov: http://127.0.0.1:$port/mcp (healthy, auto-start enabled)"
Write-Host "Existing reserved domain: https://$domain/mcp"
Write-Host 'The public tunnel is NOT started until the owner releases the Mac tunnel.'
if ($LocalOnly) {
    Write-Host 'LocalOnly mode: ngrok was deliberately not installed. Run normal setup before tunnel activation.'
}
Write-Host 'After the owner releases the old tunnel, run:'
Write-Host 'powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\activate-windows.ps1'
