param(
  [string]$LlamaWheelIndexUrl = "https://abetlen.github.io/llama-cpp-python/whl/cu124",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$TranscriptionProfile = "balanced"
)

$ErrorActionPreference = "Stop"

Write-Host "Installing Python 3.12 transcription runtime and model..."
& "$PSScriptRoot\install-transcription.ps1" -Profile $TranscriptionProfile
if ($LASTEXITCODE -ne 0) {
  throw "Transcription installation failed."
}

Write-Host "Installing Qwen3 command runtime and model..."
& "$PSScriptRoot\install-interpretation.ps1" `
  -WheelIndexUrl $LlamaWheelIndexUrl `
  -ModelCandidate qwen3
if ($LASTEXITCODE -ne 0) {
  throw "Command interpretation installation failed."
}

Write-Host ""
Write-Host "Gaming-PC setup complete."
Write-Host "Run scripts\validate-checkpoint-4.ps1 to create the report."
