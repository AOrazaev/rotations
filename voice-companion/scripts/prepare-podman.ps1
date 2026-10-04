param(
  [string]$Image = "localhost/bask-voice-companion:cpu",
  [string]$DataVolume = "bask-voice-companion-data",
  [ValidateSet("lightweight", "balanced")]
  [string]$Profile = "balanced",
  [ValidateSet("qwen3", "phi4mini")]
  [string]$ModelCandidate = "qwen3",
  [switch]$SkipBuild,
  [switch]$SkipModelDownload,
  [switch]$ForceModelDownload
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "podman-common.ps1")

$ProjectRoot = Split-Path -Parent $PSScriptRoot

if (-not $SkipBuild) {
  Write-Host "Building CPU companion image $Image..."
  Invoke-BaskPodman -Arguments @(
    "build",
    "--format", "docker",
    "--target", "cpu",
    "--tag", $Image,
    "--file", (Join-Path $ProjectRoot "Containerfile"),
    $ProjectRoot
  )
}

$podman = Get-BaskPodman
& $podman volume inspect $DataVolume *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Creating persistent data volume $DataVolume..."
  Invoke-BaskPodman -Arguments @("volume", "create", $DataVolume)
}

Invoke-BaskPodman -Arguments @(
  "run", "--rm",
  "--user", "0",
  "--volume", "${DataVolume}:/data",
  "--entrypoint", "sh",
  $Image,
  "-c", "mkdir -p /data/models /data/evaluation-samples /data/huggingface && chown -R 10001:10001 /data"
)

if (-not $SkipModelDownload) {
  $forceArgument = @()
  if ($ForceModelDownload) {
    $forceArgument = @("--force")
  }

  Write-Host "Downloading the $Profile transcription model..."
  $transcriptionArguments = @(
    "run", "--rm",
    "--volume", "${DataVolume}:/data",
    "--entrypoint", "python",
    $Image,
    "scripts/download_models.py",
    "--profile", $Profile,
    "--model-directory", "/data/models"
  ) + $forceArgument
  Invoke-BaskPodman -Arguments $transcriptionArguments

  Write-Host "Downloading the $ModelCandidate command model..."
  $commandArguments = @(
    "run", "--rm",
    "--volume", "${DataVolume}:/data",
    "--entrypoint", "python",
    $Image,
    "scripts/download_command_model.py",
    "--candidate", $ModelCandidate,
    "--model-directory", "/data/models"
  ) + $forceArgument
  Invoke-BaskPodman -Arguments $commandArguments
}

Write-Host ""
Write-Host "Podman preparation complete."
Write-Host "Start the CPU companion with:"
Write-Host "  .\voice-companion\scripts\run-podman.ps1"
