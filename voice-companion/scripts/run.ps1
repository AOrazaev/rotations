param(
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [int]$Port = 8766,
  [ValidateSet("faster-whisper", "external-command")]
  [string]$Transcriber = "faster-whisper",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$Profile = "balanced",
  [string]$Model = "",
  [string]$Device = "",
  [string]$ComputeType = ""
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
  "--profile", $Profile
)
if ($Model) { $arguments += @("--model", $Model) }
if ($Device) { $arguments += @("--device", $Device) }
if ($ComputeType) { $arguments += @("--compute-type", $ComputeType) }

& $Python @arguments
