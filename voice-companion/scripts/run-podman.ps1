param(
  [string]$Image = "localhost/bask-voice-companion:cpu",
  [string]$DataVolume = "bask-voice-companion-data",
  [string]$ContainerName = "bask-voice-companion",
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [int]$Port = 8766,
  [ValidateSet("lightweight", "balanced")]
  [string]$Profile = "balanced",
  [string]$Model = "",
  [ValidateSet("none", "llama-cpp", "llama-cpp-fact-dsl")]
  [string]$CommandInterpreter = "llama-cpp-fact-dsl",
  [string]$CommandModel = "/data/models/Qwen3-4B-Q4_K_M.gguf",
  [int]$CommandContextSize = 4096,
  [int]$ProcessingTimeoutSeconds = 120,
  [bool]$UseSshTunnel = $true
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "podman-common.ps1")

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
  "--security-opt", "no-new-privileges",
  "--env", "BASK_VOICE_TOKEN=$Token",
  $Image,
  "--host", "0.0.0.0",
  "--port", "8766",
  "--container-mode",
  "--token", $Token,
  "--transcriber", "faster-whisper",
  "--profile", $Profile,
  "--device", "cpu",
  "--compute-type", "int8",
  "--model-directory", "/data/models",
  "--evaluation-directory", "/data/evaluation-samples",
  "--command-interpreter", $CommandInterpreter,
  "--command-context-size", $CommandContextSize,
  "--command-gpu-layers", "0",
  "--processing-timeout-seconds", $ProcessingTimeoutSeconds
)
if ($Model) {
  $arguments += @("--model", $Model)
}
if ($CommandInterpreter -ne "none") {
  $arguments += @("--command-model", $CommandModel)
}

Write-Host "Starting the CPU Bask Voice Companion in Podman..."
Write-Host "  Workbench: http://127.0.0.1:$Port/"
Write-Host "  Pairing token: $Token"
Write-Host "  Persistent data: $DataVolume"
Write-Host "  Command interpreter: $CommandInterpreter"

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
