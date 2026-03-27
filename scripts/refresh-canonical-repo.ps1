param(
  [string]$EcobeMvpSource = "C:\Users\antho\.windsurf\ecobe-mvp",
  [string]$EcobeEngineSource = "C:\Users\antho\.windsurf\ecobe-engineclaude\ecobe-engine",
  [string]$LegacyWrapperSource = "C:\Users\antho\.windsurf\SekedControlPlaneMVP\_archived\seked-control-plane-wrapper\SekedControlPlaneMVP",
  [string]$DestinationRoot = "C:\Users\antho\.windsurf\SekedControlPlaneMVP"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Sync-Snapshot {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$Destination,
    [string[]]$ExcludeDirectories = @(),
    [string[]]$ExcludeFiles = @()
  )

  if (-not (Test-Path $Source)) {
    throw "Source path not found: $Source"
  }

  New-Item -ItemType Directory -Force $Destination | Out-Null

  $args = @($Source, $Destination, "/E")
  if ($ExcludeDirectories.Count -gt 0) {
    $args += "/XD"
    $args += $ExcludeDirectories
  }
  if ($ExcludeFiles.Count -gt 0) {
    $args += "/XF"
    $args += $ExcludeFiles
  }

  & robocopy @args | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Robocopy failed for $Source -> $Destination with exit code $LASTEXITCODE"
  }
}

$appsRoot = Join-Path $DestinationRoot "apps"
$legacyRoot = Join-Path $DestinationRoot "legacy"

Sync-Snapshot `
  -Source $EcobeMvpSource `
  -Destination (Join-Path $appsRoot "ecobe-mvp") `
  -ExcludeDirectories @(".git", "node_modules", ".next", ".local", "dist") `
  -ExcludeFiles @(".env", ".env.local", ".env.production.local", "tsconfig.tsbuildinfo", "tsconfig.typecheck.tsbuildinfo", "*.log")

Sync-Snapshot `
  -Source $EcobeEngineSource `
  -Destination (Join-Path $appsRoot "ecobe-engine") `
  -ExcludeDirectories @(".git", "node_modules", ".next", ".local", "dist", "data", ".claude", "demo", "ecobe-dashboard", "ecobe-engine", "github-action") `
  -ExcludeFiles @(".env", ".env.local", ".env.production.local", "tsconfig.tsbuildinfo", "tsconfig.typecheck.tsbuildinfo", "*.log")

Sync-Snapshot `
  -Source $LegacyWrapperSource `
  -Destination (Join-Path $legacyRoot "express-wrapper") `
  -ExcludeDirectories @(".git", "node_modules", "dist") `
  -ExcludeFiles @(".env", ".env.local", ".env.production.local", "tsconfig.tsbuildinfo", "*.log")

Write-Host "Canonical SEKED packaging repo refreshed successfully."
