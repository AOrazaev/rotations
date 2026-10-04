param(
  [ValidateSet("cpu", "cuda124")]
  [string]$Runtime = "cpu",
  [string]$Image = "",
  [string]$DataVolume = "bask-voice-companion-data",
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string]$Profile = "balanced",
  [string]$Output = ".\podman-real-audio-evaluation.json"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "podman-common.ps1")

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$CorpusDirectory = Join-Path $ProjectRoot "evaluation\real-audio-v1"
$OutputPath = [IO.Path]::GetFullPath($Output)
$OutputDirectory = Split-Path -Parent $OutputPath
$OutputName = Split-Path -Leaf $OutputPath
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
if (-not $Image) {
  $Image = "localhost/bask-voice-companion:$Runtime"
}
if ($Runtime -eq "cpu" -and $Profile -eq "high_accuracy") {
  throw "The high_accuracy transcription profile requires -Runtime cuda124."
}
$Device = if ($Runtime -eq "cuda124") { "cuda" } else { "cpu" }
$ComputeType = if ($Runtime -eq "cuda124") { "float16" } else { "int8" }
$CommandGpuLayers = if ($Runtime -eq "cuda124") { "-1" } else { "0" }

$arguments = @(
  "run", "--rm",
  "--name", "bask-voice-companion-evaluation"
)
if ($Runtime -eq "cuda124") {
  Assert-BaskPodmanGpu -Image $Image
  $arguments += @(
    "--cgroups", "disabled",
    "--device", "nvidia.com/gpu=all"
  )
}
$arguments += @(
  "--volume", "${DataVolume}:/data",
  "--volume", "${CorpusDirectory}:/evaluation:ro",
  "--volume", "${OutputDirectory}:/output",
  "--entrypoint", "python",
  $Image,
  "-m", "voice_companion.evaluate_real_samples",
  "--manifest", "/evaluation/manifest.json",
  "--profile", $Profile,
  "--device", $Device,
  "--compute-type", $ComputeType,
  "--model-directory", "/data/models",
  "--command-model", "/data/models/Qwen3-4B-Q4_K_M.gguf",
  "--gpu-layers", $CommandGpuLayers,
  "--interpreter", "fact-dsl-v2",
  "--mode", "end-to-end",
  "--output", "/output/$OutputName"
)
Invoke-BaskPodman -Arguments $arguments

Write-Host "Podman evaluation report: $OutputPath"
