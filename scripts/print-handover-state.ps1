[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$desktopRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$projectsRoot = (Resolve-Path (Join-Path $desktopRoot "..\..")).Path
$websiteRoot = Join-Path $projectsRoot "RiftLite-website"
$cardsUpRoot = Join-Path $projectsRoot "RiftLite\.codex-worktrees\zelonius-web-20260826"
$installerPath = Join-Path $desktopRoot "release\RiftLiteBetaInstall.exe"
$manifestPath = Join-Path $desktopRoot "release\latest.yml"

function Write-Heading([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ==="
}

function Write-GitState([string]$RepositoryPath) {
  if (-not (Test-Path -LiteralPath $RepositoryPath)) {
    Write-Host "Missing: $RepositoryPath"
    return
  }

  Write-Host "Path: $RepositoryPath"
  Write-Host "Branch: $(git -C $RepositoryPath branch --show-current)"
  Write-Host "HEAD: $(git -C $RepositoryPath rev-parse HEAD)"
  $status = @(git -C $RepositoryPath status --short)
  if ($status.Count -eq 0) {
    Write-Host "Working tree: clean"
  } else {
    Write-Host "Working tree: dirty ($($status.Count) entries)"
    $status | ForEach-Object { Write-Host $_ }
  }
}

Write-Heading "RiftLite handover snapshot"
Write-Host "Generated: $((Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz'))"
Write-Host "This command is read-only."

Write-Heading "Desktop"
Write-GitState $desktopRoot
Write-Host "Remote roles:"
Write-Host "  windows = Windows release repository"
Write-Host "  origin  = macOS release repository"
$desktopBranch = (git -C $desktopRoot branch --show-current).Trim()
$upstreamRemote = git -C $desktopRoot config --get "branch.$desktopBranch.remote"
$remoteExitCode = $LASTEXITCODE
$upstreamMerge = git -C $desktopRoot config --get "branch.$desktopBranch.merge"
$mergeExitCode = $LASTEXITCODE
if ($remoteExitCode -eq 0 -and $mergeExitCode -eq 0) {
  Write-Host "Configured upstream: $upstreamRemote/$($upstreamMerge -replace '^refs/heads/', '')"
} else {
  Write-Host "Configured upstream: none (any authorized push must name a remote explicitly)"
}
Write-Host "Remote refs below are local fetch snapshots and may be stale:"
foreach ($remoteRef in @("refs/remotes/windows/main", "refs/remotes/origin/main")) {
  $resolved = git -C $desktopRoot rev-parse --verify $remoteRef 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Host "  $remoteRef = $resolved"
  } else {
    Write-Host "  $remoteRef = unavailable"
  }
}
$packageJson = Get-Content -LiteralPath (Join-Path $desktopRoot "package.json") -Raw | ConvertFrom-Json
Write-Host "Package version: $($packageJson.version)"

Write-Heading "Local Windows artifact"
if (Test-Path -LiteralPath $installerPath) {
  $installer = Get-Item -LiteralPath $installerPath
  $hash = Get-FileHash -LiteralPath $installerPath -Algorithm SHA256
  Write-Host "Path: $($installer.FullName)"
  Write-Host "Bytes: $($installer.Length)"
  Write-Host "Modified: $($installer.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
  Write-Host "SHA-256: $($hash.Hash)"
} else {
  Write-Host "No local Windows installer found."
}
if (Test-Path -LiteralPath $manifestPath) {
  Write-Host "latest.yml:"
  Get-Content -LiteralPath $manifestPath | ForEach-Object { Write-Host "  $_" }
}

Write-Heading "Website checkout"
Write-GitState $websiteRoot

Write-Heading "Cards Up / public combiner worktree"
Write-GitState $cardsUpRoot

Write-Heading "Common development ports"
$ports = @(3000, 3001, 3002, 5173, 5174)
$listeners = foreach ($port in $ports) {
  Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object LocalAddress, LocalPort, OwningProcess
}
if (@($listeners).Count -eq 0) {
  Write-Host "No listeners on ports $($ports -join ', ')."
} else {
  $listeners | Format-Table -AutoSize | Out-String | Write-Host
}

Write-Heading "Next document"
Write-Host (Join-Path $desktopRoot "docs\HANDOVER-2026-08-30.md")
