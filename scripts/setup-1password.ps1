# Connects 1Password so Arbora can fill logins. The password stays in 1Password.
#   powershell -File scripts/setup-1password.ps1 -Check
#   powershell -File scripts/setup-1password.ps1 -Yes
#   powershell -File scripts/setup-1password.ps1 -Uninstall
param(
  [switch]$Check,
  [switch]$Yes,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

function Show-OpStatus {
  $command = Get-Command op -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    Write-Output 'op: not installed'
    return $false
  }
  $version = & op --version 2>$null
  if ([string]::IsNullOrWhiteSpace($version)) { $version = 'present' }
  Write-Output "op: $version"
  return $true
}

function Show-CheckRow([string]$Label, [string]$State, [string]$Detail) {
  if ([string]::IsNullOrWhiteSpace($Detail)) {
    Write-Output "$Label`: $State"
  } else {
    Write-Output "$Label`: $State ($Detail)"
  }
}

if ($Check) {
  Write-Output "os: Windows"
  $installed = Show-OpStatus
  if ($installed) {
    $accounts = & op account list --format json 2>$null
    if ($accounts -match '^\[\]') { Show-CheckRow account fail 'no account' }
    elseif ($accounts -match '^\[') { Show-CheckRow account pass 'signed in' }
    else { Show-CheckRow account fail 'could not list accounts' }
  } else {
    Show-CheckRow account fail 'op is not installed'
  }
  $desktop = Get-Process -Name '1Password' -ErrorAction SilentlyContinue
  if ($null -eq $desktop) { Show-CheckRow desktop fail 'app not running' } else { Show-CheckRow desktop pass '' }
  $root = Split-Path -Parent $PSScriptRoot
  $extension = Join-Path $root 'apps\desktop\resources\extensions\1password\manifest.json'
  if (Test-Path $extension) { Show-CheckRow extension pass '' } else { Show-CheckRow extension fail 'not downloaded' }
  Write-Output 'This check does not install anything and does not use sudo.'
  if ($installed) { exit 0 } else { exit 1 }
}

Write-Output '1Password for Arbora. Turn on Integrate with 1Password CLI in the 1Password app.'
Write-Output 'Browser integration lets the extension fill pages. Arbora''s agent uses the op command.'

if ($Uninstall) {
  Write-Output 'Uninstall from Settings → Apps, or: winget uninstall AgileBits.1Password AgileBits.1Password.CLI'
  exit 0
}

Write-Output 'Install: winget install AgileBits.1Password AgileBits.1Password.CLI'
if ($Yes -and (Get-Command winget -ErrorAction SilentlyContinue)) {
  winget install AgileBits.1Password AgileBits.1Password.CLI
}

Write-Output 'When op is on your PATH, pnpm setup:1password --check should print its version.'
