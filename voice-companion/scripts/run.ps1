param(
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [switch]$DisableAuthentication,
  [int]$Port = 8766,
  [ValidateSet("faster-whisper", "external-command")]
  [string]$Transcriber = "faster-whisper",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$Profile = "balanced",
  [string]$Model = "",
  [string]$Device = "",
  [string]$ComputeType = "",
  [ValidateSet("none", "llama-cpp", "llama-cpp-fact-dsl")]
  [string]$CommandInterpreter = "llama-cpp-fact-dsl",
  [string]$CommandModel = "",
  [int]$CommandContextSize = 4096,
  [int]$CommandGpuLayers = 0,
  [int]$ProcessingTimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VirtualPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $VirtualPython)) {
  throw @"
The companion environment is not installed:
  $VirtualPython

From the repository root, run:
  .\voice-companion\scripts\prepare-gaming-pc.ps1 -CommandRuntime cpu

Use -CommandRuntime cuda124 only when the CUDA 12.4 runtime is installed.
"@
}

$VirtualVersion = (& $VirtualPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')").Trim()
if ($LASTEXITCODE -ne 0 -or $VirtualVersion -ne "3.12") {
  throw "The companion environment must use Python 3.12; found '$VirtualVersion'."
}
if (-not $DisableAuthentication -and -not $Token) {
  $Token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
}

$env:PYTHONPATH = Join-Path $ProjectRoot "src"
$Python = $VirtualPython
$arguments = @(
  "-m", "voice_companion",
  "--port", $Port,
  "--token", $Token,
  "--transcriber", $Transcriber,
  "--profile", $Profile,
  "--command-interpreter", $CommandInterpreter,
  "--command-context-size", $CommandContextSize,
  "--command-gpu-layers", $CommandGpuLayers,
  "--processing-timeout-seconds", $ProcessingTimeoutSeconds
)
if ($DisableAuthentication) { $arguments += "--disable-authentication" }
if ($Model) { $arguments += @("--model", $Model) }
if ($Device) { $arguments += @("--device", $Device) }
if ($ComputeType) { $arguments += @("--compute-type", $ComputeType) }
if ($CommandModel) { $arguments += @("--command-model", $CommandModel) }

Write-Host "Starting Bask Voice Companion..."
Write-Host "  Python: $VirtualPython"
Write-Host "  Transcription profile: $Profile"
Write-Host "  Command interpreter: $CommandInterpreter"
& $Python @arguments
