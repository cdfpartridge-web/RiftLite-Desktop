$ErrorActionPreference = "Stop"

$projectDirectory = Resolve-Path (Join-Path $PSScriptRoot "..")
$packageManifest = Get-Content -LiteralPath (Join-Path $projectDirectory "package.json") -Raw | ConvertFrom-Json
$expectedVersion = [string]$packageManifest.version
$expectedProductName = [string]$packageManifest.build.productName
$releaseDirectoryResolver = Join-Path $PSScriptRoot "release-directory.mjs"
$releaseDirectoryOutput = & node $releaseDirectoryResolver 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) {
  throw "Could not resolve the Windows release directory.`n$releaseDirectoryOutput"
}
$releaseDirectory = $releaseDirectoryOutput.Trim()
if (-not $releaseDirectory) {
  throw "The Windows release directory resolver returned an empty path."
}
$installerPath = Join-Path $releaseDirectory "RiftLiteBetaInstall.exe"
$unpackedExecutablePath = Join-Path $releaseDirectory "win-unpacked\RiftLite Beta 0.9.exe"

foreach ($path in @($installerPath, $unpackedExecutablePath)) {
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

Write-Output "Windows executable metadata verified for v$expectedVersion."
