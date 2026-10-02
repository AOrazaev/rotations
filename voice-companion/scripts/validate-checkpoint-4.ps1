param(
  [int]$CommandGpuLayers = -1,
  [int]$Repetitions = 7,
  [int]$DelayBetweenRoundsSeconds = 300,
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$TranscriptionProfile = "balanced",
  [string]$CommandModel = "",
  [string]$ResultsDirectory = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RepositoryRoot = Split-Path -Parent $ProjectRoot
$VirtualPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VirtualPython)) {
  throw "Python environment is missing. Run scripts\prepare-gaming-pc.ps1 first."
}

if (-not $CommandModel) {
  $CommandModel = Join-Path $env:LOCALAPPDATA `
    "BaskVoiceCompanion\models\Qwen3-4B-Q4_K_M.gguf"
}
if (-not (Test-Path $CommandModel)) {
  throw "Command model not found at $CommandModel. Run scripts\prepare-gaming-pc.ps1 first."
}

if (-not $ResultsDirectory) {
  $ResultsDirectory = Join-Path $ProjectRoot "validation-results"
}
$Timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$Output = Join-Path $ResultsDirectory "checkpoint-4-$Timestamp.json"
$Revision = (& git -C $RepositoryRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) {
  throw "Could not determine the repository revision."
}

$env:PYTHONPATH = Join-Path $ProjectRoot "src"
$Arguments = @(
  "-m", "voice_companion.validate_checkpoint4",
  "--model", $CommandModel,
  "--gpu-layers", $CommandGpuLayers,
  "--transcription-profile", $TranscriptionProfile,
  "--repetitions", $Repetitions,
  "--delay-between-rounds-seconds", $DelayBetweenRoundsSeconds,
  "--source-revision", $Revision,
  "--output", $Output
)

Write-Host "Running Checkpoint 4 validation."
Write-Host "Repetitions: $Repetitions (8 commands each)"
Write-Host "Delay between rounds: $DelayBetweenRoundsSeconds seconds"
Write-Host "GPU layers: $CommandGpuLayers"
Write-Host "Transcription profile: $TranscriptionProfile"
Write-Host "Report: $Output"
& $VirtualPython @Arguments
$ValidationExitCode = $LASTEXITCODE

Write-Host ""
if ($ValidationExitCode -eq 0) {
  Write-Host "Validation passed. Return this file:"
} else {
  Write-Warning "Validation reported a failure. Return this file for diagnosis:"
}
Write-Host "  $Output"
exit $ValidationExitCode
