param(
  [string]$MachineName = ""
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "podman-common.ps1")

$podman = Get-BaskPodman
$machine = Get-BaskPodmanMachine
if (-not $MachineName) {
  $MachineName = $machine.Name
}
if ($MachineName -ne $machine.Name) {
  throw "The requested machine '$MachineName' is not the running Podman machine."
}

$setupCommand = @'
set -e
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo \
  | tee /etc/yum.repos.d/nvidia-container-toolkit.repo >/dev/null
dnf install -y nvidia-container-toolkit
mkdir -p /etc/cdi
nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
nvidia-ctk cdi list
'@
$encodedSetup = [Convert]::ToBase64String(
  [Text.Encoding]::UTF8.GetBytes($setupCommand)
)

Write-Host "Installing NVIDIA Container Toolkit in $MachineName..."
& $podman machine ssh --username root $MachineName `
  "echo $encodedSetup | base64 -d | bash"
if ($LASTEXITCODE -ne 0) {
  throw "NVIDIA Container Toolkit setup failed."
}

Write-Host "Verifying NVIDIA GPU access through CDI..."
Invoke-BaskPodman -Arguments @(
  "run", "--rm",
  "--device", "nvidia.com/gpu=all",
  "docker.io/nvidia/cuda:12.4.1-base-ubuntu22.04",
  "nvidia-smi"
)

Write-Host ""
Write-Host "Podman GPU access is ready."
Write-Host "Build the CUDA companion image with:"
Write-Host "  .\voice-companion\scripts\prepare-podman.ps1 -Runtime cuda124"
