param(
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [int]$Port = 8766,
  [ValidateSet("faster-whisper", "external-command")]
  [string]$Transcriber = "faster-whisper",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$Profile = "balanced",
  [string]$Model = "",
  [string]$Device = "",
  [string]$ComputeType = "",
  [ValidateSet("none", "llama-cpp")]
  [string]$CommandInterpreter = "none",
  [string]$CommandModel = "",
  [int]$CommandContextSize = 4096,
  [int]$CommandGpuLayers = 0
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VirtualPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not $Token) {
  $Token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
}

$env:PYTHONPATH = Join-Path $ProjectRoot "src"
$Python = if (Test-Path $VirtualPython) { $VirtualPython } else { "python" }
$arguments = @(
  "-m", "voice_companion",
  "--port", $Port,
  "--token", $Token,
  "--transcriber", $Transcriber,
  "--profile", $Profile,
  "--command-interpreter", $CommandInterpreter,
  "--command-context-size", $CommandContextSize,
  "--command-gpu-layers", $CommandGpuLayers
)
if ($Model) { $arguments += @("--model", $Model) }
if ($Device) { $arguments += @("--device", $Device) }
if ($ComputeType) { $arguments += @("--compute-type", $ComputeType) }
if ($CommandModel) { $arguments += @("--command-model", $CommandModel) }

& $Python @arguments
