param(
  [ValidateSet("cpu", "cuda124")]
  [string]$Runtime = "cpu",
  [string]$Image = "",
  [string]$DataVolume = "bask-voice-companion-data",
  [string]$ContainerName = "bask-voice-companion",
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [int]$Port = 8766,
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$Profile = "balanced",
  [string]$Model = "",
  [ValidateSet("none", "llama-cpp", "llama-cpp-fact-dsl")]
  [string]$CommandInterpreter = "llama-cpp-fact-dsl",
  [string]$CommandModel = "/data/models/Qwen3-4B-Q4_K_M.gguf",
  [int]$CommandContextSize = 4096,
  [Nullable[int]]$CommandGpuLayers = $null,
  [int]$ProcessingTimeoutSeconds = 120,
  [bool]$UseSshTunnel = $true
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "podman-common.ps1")

if (-not $Image) {
  $Image = "localhost/bask-voice-companion:$Runtime"
}
if ($Runtime -eq "cpu" -and $Profile -eq "high_accuracy") {
  throw "The high_accuracy transcription profile requires -Runtime cuda124."
}
$Device = if ($Runtime -eq "cuda124") { "cuda" } else { "cpu" }
$ComputeType = if ($Runtime -eq "cuda124") { "float16" } else { "int8" }
if ($null -eq $CommandGpuLayers) {
  $CommandGpuLayers = if ($Runtime -eq "cuda124") { -1 } else { 0 }
}

if (-not $Token) {
  $Token = [Convert]::ToBase64String(
    [Security.Cryptography.RandomNumberGenerator]::GetBytes(24)
  )
}

$arguments = @(
  "run", "--rm",
  "--name", $ContainerName,
  "--publish", "127.0.0.1:${Port}:8766",
  "--volume", "${DataVolume}:/data",
  "--read-only",
  "--tmpfs", "/tmp:rw,noexec,nosuid,size=512m",
  "--cap-drop", "all",
  "--security-opt", "no-new-privileges"
)
if ($Runtime -eq "cuda124") {
  $arguments += @(
    "--cgroups=disabled",
    "--device", "nvidia.com/gpu=all"
  )
}
$arguments += @(
  "--env", "BASK_VOICE_TOKEN=$Token",
  $Image,
  "--host", "0.0.0.0",
  "--port", "8766",
  "--container-mode",
  "--token", $Token,
  "--transcriber", "faster-whisper",
  "--profile", $Profile,
  "--device", $Device,
  "--compute-type", $ComputeType,
  "--model-directory", "/data/models",
  "--evaluation-directory", "/data/evaluation-samples",
  "--command-interpreter", $CommandInterpreter,
  "--command-context-size", $CommandContextSize,
  "--command-gpu-layers", $CommandGpuLayers,
  "--processing-timeout-seconds", $ProcessingTimeoutSeconds
)
if ($Model) {
  $arguments += @("--model", $Model)
}
if ($CommandInterpreter -ne "none") {
  $arguments += @("--command-model", $CommandModel)
}

if ($Runtime -eq "cuda124") {
  Assert-BaskPodmanGpu -Image $Image
}

Write-Host "Starting the $Runtime Bask Voice Companion in Podman..."
Write-Host "  Workbench: http://127.0.0.1:$Port/"
Write-Host "  Pairing token: $Token"
Write-Host "  Persistent data: $DataVolume"
Write-Host "  Transcription device: $Device ($ComputeType)"
Write-Host "  Command interpreter: $CommandInterpreter"
Write-Host "  Command GPU layers: $CommandGpuLayers"

$tunnel = $null
try {
  if ($UseSshTunnel) {
    Write-Host "  Windows loopback: Podman machine SSH tunnel"
    $tunnel = Start-BaskPodmanLoopbackTunnel -Port $Port
  }
  Invoke-BaskPodman -Arguments $arguments -SuccessExitCodes @(0, 130, 137)
}
finally {
  if ($tunnel -and -not $tunnel.HasExited) {
    Stop-Process -Id $tunnel.Id
    $tunnel.WaitForExit()
  }
}
