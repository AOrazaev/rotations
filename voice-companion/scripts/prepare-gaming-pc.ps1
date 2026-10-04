param(
  [ValidateSet("cuda124", "cpu")]
  [string]$CommandRuntime = "cuda124",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$TranscriptionProfile = "balanced",
  [switch]$ForceRuntimeReinstall
)

$ErrorActionPreference = "Stop"

Write-Host "Installing Python 3.12 transcription runtime and model..."
& "$PSScriptRoot\install-transcription.ps1" -Profile $TranscriptionProfile
if ($LASTEXITCODE -ne 0) {
  throw "Transcription installation failed."
}

Write-Host "Installing Qwen3 command runtime and model..."
$LlamaWheelIndexUrl = if ($CommandRuntime -eq "cuda124") {
  "https://abetlen.github.io/llama-cpp-python/whl/cu124"
} else {
  "https://abetlen.github.io/llama-cpp-python/whl/cpu"
}
$InterpretationArguments = @{
  WheelIndexUrl = $LlamaWheelIndexUrl
  ModelCandidate = "qwen3"
  ForceRuntimeReinstall = $ForceRuntimeReinstall
}
& "$PSScriptRoot\install-interpretation.ps1" @InterpretationArguments
if ($LASTEXITCODE -ne 0) {
  throw "Command interpretation installation failed."
}

Write-Host ""
Write-Host "Gaming-PC setup complete."
Write-Host "Start the companion with:"
Write-Host "  .\voice-companion\scripts\run.ps1 -Profile $TranscriptionProfile"
Write-Host ""
Write-Host "Optional validation:"
Write-Host "  .\voice-companion\scripts\validate-checkpoint-4.ps1"
