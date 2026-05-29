param(
  [string]$IndexPath = "",
  [string]$ChannelPrefix = "beta",
  [string]$Platform = "win",
  [switch]$Publish,
  [switch]$Probe,
  [switch]$ProbeOnly
)

$ErrorActionPreference = "Stop"

function Require-Env([string]$Name) {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "$Name is required"
  }
  return $value
}

function Optional-Env([string]$Name, [string]$Fallback = "") {
  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $Fallback
  }
  return $value
}

function Get-PublicOrigin {
  $value = Optional-Env "S3_PUBLIC_ORIGIN"
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "S3_PUBLIC_ORIGIN is required; refuse to derive public metadata URLs from the private S3 endpoint"
  }
  return $value.TrimEnd('/')
}

function Set-GitHubOutput([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Name) -or [string]::IsNullOrWhiteSpace($Value)) {
    return
  }
  if ([string]::IsNullOrWhiteSpace($env:GITHUB_OUTPUT)) {
    return
  }
  "$Name=$Value" | Add-Content -Path $env:GITHUB_OUTPUT -Encoding utf8
}

function Get-BetaVersionParts([string]$Version) {
  if ($Version -notmatch '^(?<base>\d+\.\d+\.\d+)-beta\.(?<number>\d+)$') {
    throw "release version must match x.y.z-beta.N; got $Version"
  }
  return [ordered]@{
    baseVersion = $Matches.base
    betaNumber = [int]$Matches.number
  }
}

function Normalize-ObjectKey([string]$Value) {
  return ($Value -replace "\\", "/").Trim("/")
}

function Assert-SafePrefix([string]$Value) {
  $prefix = Normalize-ObjectKey $Value
  if ([string]::IsNullOrWhiteSpace($prefix) -or $prefix -eq "." -or $prefix -eq "/") {
    throw "channel prefix must not be empty or bucket root"
  }
  if ($prefix.Contains("..") -or $prefix.StartsWith("/") -or $prefix.StartsWith("~")) {
    throw "unsafe channel prefix: $Value"
  }
  return $prefix
}

function Get-ContentType([string]$Name) {
  if ($Name.EndsWith(".exe", [System.StringComparison]::OrdinalIgnoreCase)) { return "application/vnd.microsoft.portable-executable" }
  if ($Name.EndsWith(".zip", [System.StringComparison]::OrdinalIgnoreCase)) { return "application/zip" }
  if ($Name.EndsWith(".sha256", [System.StringComparison]::OrdinalIgnoreCase)) { return "text/plain; charset=utf-8" }
  if ($Name.EndsWith(".yml", [System.StringComparison]::OrdinalIgnoreCase) -or $Name.EndsWith(".yaml", [System.StringComparison]::OrdinalIgnoreCase)) { return "application/x-yaml; charset=utf-8" }
  if ($Name.EndsWith(".json", [System.StringComparison]::OrdinalIgnoreCase)) { return "application/json; charset=utf-8" }
  return "application/octet-stream"
}

function Copy-Artifact([string]$Source, [string]$Name, [string]$ReleaseDir) {
  if ([string]::IsNullOrWhiteSpace($Source) -or -not (Test-Path -LiteralPath $Source)) {
    throw "expected artifact not found: $Source"
  }
  $target = Join-Path $ReleaseDir $Name
  Copy-Item -LiteralPath $Source -Destination $target -Force
  $hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $Name" | Set-Content -Path (Join-Path $ReleaseDir "$Name.sha256") -Encoding utf8
  return [ordered]@{
    name = $Name
    path = $target
    sha256 = $hash
    size = (Get-Item -LiteralPath $target).Length
  }
}

function Invoke-Mc([string[]]$Arguments) {
  & mc @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "mc failed with exit code ${LASTEXITCODE}: $($Arguments -join ' ')"
  }
}

if ($Platform -ne "win") {
  throw "publish-beta.ps1 currently supports win only"
}

$channel = Assert-SafePrefix $ChannelPrefix
if ([string]::IsNullOrWhiteSpace($IndexPath)) {
  $IndexPath = "C:\.tmp\runner\od-beta\win\index\index.json"
}
if (-not (Test-Path -LiteralPath $IndexPath)) {
  throw "release index not found: $IndexPath"
}

$index = Get-Content -LiteralPath $IndexPath -Raw -Encoding utf8 | ConvertFrom-Json
if ($index.channel -ne "beta") { throw "release index channel must be beta; got $($index.channel)" }
if ($index.platform -ne "win") { throw "release index platform must be win; got $($index.platform)" }
if ($index.status -ne "success") { throw "release index status must be success; got $($index.status)" }

$releaseVersion = [string]$index.releaseVersion
if ([string]::IsNullOrWhiteSpace($releaseVersion)) {
  throw "release index missing releaseVersion"
}

$root = if ([string]::IsNullOrWhiteSpace([string]$index.root)) {
  Split-Path -Parent (Split-Path -Parent $IndexPath)
} else {
  [string]$index.root
}
$platformRoot = Join-Path $root "win"
$stageRoot = Join-Path $platformRoot "publish"
$releaseDir = Join-Path $stageRoot "release-assets"
$manifestDir = Join-Path $stageRoot "manifests"
New-Item -ItemType Directory -Force -Path $releaseDir, $manifestDir | Out-Null

$signed = [bool]$index.signed
$assetSuffix = if ($signed) { "" } else { ".unsigned" }
$versionParts = Get-BetaVersionParts $releaseVersion
$installerName = "open-design-$releaseVersion$assetSuffix-win-x64-setup.exe"
$portableZipName = "open-design-$releaseVersion$assetSuffix-win-x64-portable.zip"

$installer = Copy-Artifact ([string]$index.artifacts.installerPath) $installerName $releaseDir
$portableZip = $null
if (-not [string]::IsNullOrWhiteSpace([string]$index.artifacts.portableZipPath)) {
  $portableZip = Copy-Artifact ([string]$index.artifacts.portableZipPath) $portableZipName $releaseDir
}

$endpoint = Require-Env "S3_ENDPOINT"
$bucket = Require-Env "S3_BUCKET"
$accessKey = Require-Env "S3_ACCESS_KEY_ID"
$secretKey = Require-Env "S3_SECRET_ACCESS_KEY"
$publicOrigin = Get-PublicOrigin
$versionPrefix = "$channel/versions/$releaseVersion$assetSuffix"
$latestPrefix = "$channel/latest"
$installerUrl = "$publicOrigin/$versionPrefix/$installerName"
$latestMetadataUrl = "$publicOrigin/$latestPrefix/metadata.json"
$versionMetadataUrl = "$publicOrigin/$versionPrefix/metadata.json"
$latestManifestUrl = "$publicOrigin/$latestPrefix/platforms/win.json"
$versionManifestUrl = "$publicOrigin/$versionPrefix/platforms/win.json"
$installerBytes = [System.IO.File]::ReadAllBytes($installer.path)
$installerSha512 = [System.Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash($installerBytes))
$releaseDate = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")

@(
  "version: `"$releaseVersion`"",
  "files:",
  "  - url: `"$installerUrl`"",
  "    sha512: `"$installerSha512`"",
  "    size: $($installer.size)",
  "path: `"$installerUrl`"",
  "sha512: `"$installerSha512`"",
  "releaseDate: `"$releaseDate`"",
  "releaseNotes: `"Open Design beta $releaseVersion$assetSuffix`""
) | Set-Content -Path (Join-Path $releaseDir "latest.yml") -Encoding utf8

$artifacts = [ordered]@{
  installer = [ordered]@{
    contentType = Get-ContentType $installerName
    name = $installerName
    objectKey = "$versionPrefix/$installerName"
    sha256 = $installer.sha256
    sha256ObjectKey = "$versionPrefix/$installerName.sha256"
    sha256Url = "$publicOrigin/$versionPrefix/$installerName.sha256"
    size = $installer.size
    url = "$publicOrigin/$versionPrefix/$installerName"
  }
}
if ($portableZip -ne $null) {
  $artifacts.portableZip = [ordered]@{
    contentType = Get-ContentType $portableZipName
    name = $portableZipName
    objectKey = "$versionPrefix/$portableZipName"
    sha256 = $portableZip.sha256
    sha256ObjectKey = "$versionPrefix/$portableZipName.sha256"
    sha256Url = "$publicOrigin/$versionPrefix/$portableZipName.sha256"
    size = $portableZip.size
    url = "$publicOrigin/$versionPrefix/$portableZipName"
  }
}

$manifest = [ordered]@{
  arch = "x64"
  artifacts = $artifacts
  channel = "beta"
  enabled = $true
  feed = [ordered]@{
    latestObjectKey = "$latestPrefix/latest.yml"
    latestUrl = "$publicOrigin/$latestPrefix/latest.yml"
    name = "latest.yml"
    objectKey = "$versionPrefix/latest.yml"
    url = "$publicOrigin/$versionPrefix/latest.yml"
  }
  generatedAt = [DateTime]::UtcNow.ToString("o")
  github = [ordered]@{
    branch = $env:GITHUB_REF_NAME
    commit = $env:GITHUB_SHA
    repository = $env:GITHUB_REPOSITORY
    runAttempt = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ATTEMPT)) { 0 } else { [int]$env:GITHUB_RUN_ATTEMPT }
    runId = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) { 0 } else { [int64]$env:GITHUB_RUN_ID }
    workflow = $env:GITHUB_WORKFLOW
  }
  label = "Windows x64"
  platform = "win"
  platformKey = "win"
  r2 = [ordered]@{
    latestManifestUrl = $latestManifestUrl
    latestPrefix = $latestPrefix
    publicOrigin = $publicOrigin
    versionManifestUrl = $versionManifestUrl
    versionPrefix = $versionPrefix
  }
  releaseVersion = $releaseVersion
  s3 = [ordered]@{
    latestManifestObjectKey = "$latestPrefix/platforms/win.json"
    latestPrefix = $latestPrefix
    versionManifestObjectKey = "$versionPrefix/platforms/win.json"
    versionPrefix = $versionPrefix
  }
  signed = $signed
  status = "published"
  version = 1
}
$manifestPath = Join-Path $manifestDir "win.json"
$manifest | ConvertTo-Json -Depth 8 | Set-Content -Path $manifestPath -Encoding utf8

$stateSource = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) {
  "release-beta-s local publish"
} else {
  "release-beta-s workflow_dispatch input"
}
$metadata = [ordered]@{
  assetVersionSuffix = $assetSuffix
  baseVersion = $versionParts.baseVersion
  betaNumber = $versionParts.betaNumber
  betaVersion = $releaseVersion
  channel = "beta"
  expectedPlatforms = @("win")
  failedPlatforms = @()
  generatedAt = [DateTime]::UtcNow.ToString("o")
  github = $manifest.github
  platforms = [ordered]@{
    win = $manifest
  }
  r2 = [ordered]@{
    latestMetadataUrl = $latestMetadataUrl
    latestMetadataUpdated = $true
    latestPrefix = $latestPrefix
    publicOrigin = $publicOrigin
    report = $null
    reportUrl = $null
    reportZipUrl = $null
    versionMetadataUrl = $versionMetadataUrl
    versionPrefix = $versionPrefix
  }
  readyPlatforms = @("win")
  releaseState = "complete"
  signed = $signed
  stateSource = $stateSource
  version = 1
}
$metadataPath = Join-Path $manifestDir "metadata.json"
$metadata | ConvertTo-Json -Depth 10 | Set-Content -Path $metadataPath -Encoding utf8

$publishIndex = [ordered]@{
  artifacts = $artifacts
  channel = "beta"
  generatedAt = [DateTime]::UtcNow.ToString("o")
  platform = "win"
  releaseVersion = $releaseVersion
  signed = $signed
  target = $index.target
  versionPrefix = $versionPrefix
}
$publishIndexPath = Join-Path $manifestDir "index.json"
$publishIndex | ConvertTo-Json -Depth 8 | Set-Content -Path $publishIndexPath -Encoding utf8

$uploads = @(
  @{ path = $installer.path; key = "$versionPrefix/$installerName"; cache = "public, max-age=31536000, immutable" },
  @{ path = "$($installer.path).sha256"; key = "$versionPrefix/$installerName.sha256"; cache = "public, max-age=31536000, immutable" },
  @{ path = (Join-Path $releaseDir "latest.yml"); key = "$versionPrefix/latest.yml"; cache = "public, max-age=31536000, immutable" },
  @{ path = (Join-Path $releaseDir "latest.yml"); key = "$latestPrefix/latest.yml"; cache = "public, max-age=60, must-revalidate" },
  @{ path = $metadataPath; key = "$versionPrefix/metadata.json"; cache = "public, max-age=31536000, immutable" },
  @{ path = $metadataPath; key = "$latestPrefix/metadata.json"; cache = "public, max-age=60, must-revalidate" },
  @{ path = $manifestPath; key = "$versionPrefix/platforms/win.json"; cache = "public, max-age=31536000, immutable" },
  @{ path = $manifestPath; key = "$latestPrefix/platforms/win.json"; cache = "public, max-age=60, must-revalidate" },
  @{ path = $publishIndexPath; key = "$versionPrefix/index.json"; cache = "public, max-age=31536000, immutable" },
  @{ path = $publishIndexPath; key = "$latestPrefix/index.json"; cache = "public, max-age=60, must-revalidate" }
)
if ($portableZip -ne $null) {
  $uploads += @{ path = $portableZip.path; key = "$versionPrefix/$portableZipName"; cache = "public, max-age=31536000, immutable" }
  $uploads += @{ path = "$($portableZip.path).sha256"; key = "$versionPrefix/$portableZipName.sha256"; cache = "public, max-age=31536000, immutable" }
}

Write-Host "release-beta publish plan:"
Write-Host "- channelPrefix: $channel"
Write-Host "- releaseVersion: $releaseVersion"
Write-Host "- signed: $signed"
Write-Host "- latestMetadataUrl: $latestMetadataUrl"
foreach ($upload in $uploads) {
  $size = (Get-Item -LiteralPath $upload.path).Length
  Write-Host "- $($upload.key) ($size bytes)"
}

Set-GitHubOutput "metadata_url" $latestMetadataUrl
Set-GitHubOutput "version_metadata_url" $versionMetadataUrl
Set-GitHubOutput "version_prefix" $versionPrefix

if (-not $Publish) {
  Write-Host "dry-run only; pass -Publish to upload"
  exit 0
}
if ($ProbeOnly -and -not $Probe) {
  throw "-ProbeOnly requires -Probe"
}

$mcConfigDir = Join-Path $stageRoot "mc-config"
$alias = "od-release-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $mcConfigDir | Out-Null
try {
  Invoke-Mc @("--config-dir", $mcConfigDir, "alias", "set", $alias, $endpoint, $accessKey, $secretKey, "--api", "S3v4")
  Invoke-Mc @("--config-dir", $mcConfigDir, "stat", "$alias/$bucket")

  if ($Probe) {
    $probeRunId = if ([string]::IsNullOrWhiteSpace($env:GITHUB_RUN_ID)) { "local" } else { $env:GITHUB_RUN_ID }
    $probeKey = "$channel/.probe/$probeRunId-$([Guid]::NewGuid().ToString('N')).json"
    $probePath = Join-Path $stageRoot "probe.json"
    ([ordered]@{
      generatedAt = [DateTime]::UtcNow.ToString("o")
      key = $probeKey
      purpose = "release-beta-s publish probe"
    } | ConvertTo-Json) | Set-Content -Path $probePath -Encoding utf8
    Invoke-Mc @("--config-dir", $mcConfigDir, "cp", "--attr", "Content-Type=application/json;Cache-Control=no-store", $probePath, "$alias/$bucket/$probeKey")
    Invoke-Mc @("--config-dir", $mcConfigDir, "stat", "$alias/$bucket/$probeKey")
    Invoke-Mc @("--config-dir", $mcConfigDir, "rm", "$alias/$bucket/$probeKey")
    Write-Host "probe ok: $probeKey"
  }

  if ($ProbeOnly) {
    Write-Host "probe-only mode; release objects were not uploaded"
    exit 0
  }

  foreach ($upload in $uploads) {
    $contentType = Get-ContentType ([System.IO.Path]::GetFileName([string]$upload.path))
    Invoke-Mc @("--config-dir", $mcConfigDir, "cp", "--attr", "Content-Type=$contentType;Cache-Control=$($upload.cache)", [string]$upload.path, "$alias/$bucket/$($upload.key)")
  }

  if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_STEP_SUMMARY)) {
    @(
      "",
      "## release-beta-s publish",
      "",
      "- channelPrefix: ``$channel``",
      "- releaseVersion: ``$releaseVersion``",
      "- signed: ``$signed``",
      "- metadataUrl: ``$latestMetadataUrl``",
      "- versionPrefix: ``$versionPrefix``",
      "- uploadedObjects: ``$($uploads.Count)``"
    ) | Add-Content -Path $env:GITHUB_STEP_SUMMARY -Encoding utf8
  }
} finally {
  & mc --config-dir $mcConfigDir alias remove $alias *> $null
  Remove-Item -LiteralPath $mcConfigDir -Recurse -Force -ErrorAction SilentlyContinue
  $secretKey = $null
  $accessKey = $null
}
