$ErrorActionPreference = "Stop"

$projectDirectory = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageManifest = Get-Content -LiteralPath (Join-Path $projectDirectory "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageManifest.version
$expectedProductName = [string]$packageManifest.build.productName
$installerPath = Join-Path $projectDirectory "release\RiftLiteBetaInstall.exe"
$unpackedExecutablePath = Join-Path $projectDirectory "release\win-unpacked\RiftLite Beta 0.9.exe"
$sevenZipPath = Join-Path $projectDirectory "node_modules\7zip-bin\win\x64\7za.exe"

foreach ($path in @($installerPath, $unpackedExecutablePath, $sevenZipPath)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Required Windows release file is missing: $path"
  }
}

foreach ($path in @($installerPath, $unpackedExecutablePath)) {
  $versionInfo = (Get-Item -LiteralPath $path).VersionInfo
  if ($versionInfo.ProductName -ne $expectedProductName) {
    throw "Unexpected ProductName in $path`: $($versionInfo.ProductName)"
  }
  if ($versionInfo.ProductVersion -ne $expectedVersion -or $versionInfo.FileVersion -ne $expectedVersion) {
    throw "Unexpected version in $path`: product=$($versionInfo.ProductVersion), file=$($versionInfo.FileVersion), expected=$expectedVersion"
  }
}

$archiveOutput = & $sevenZipPath t $installerPath 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $archiveOutput -notmatch "Everything is Ok") {
  throw "NSIS archive integrity verification failed.`n$archiveOutput"
}

Write-Output "Windows executable metadata and NSIS archive integrity verified for v$expectedVersion."
