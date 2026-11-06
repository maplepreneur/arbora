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

if ($Check) {
  $installed = Show-OpStatus
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
