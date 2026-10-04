param(
  [string]$Image = "localhost/bask-voice-companion:cpu",
  [string]$DataVolume = "bask-voice-companion-data",
  [ValidateSet("lightweight", "balanced")]
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

Invoke-BaskPodman -Arguments @(
  "run", "--rm",
  "--name", "bask-voice-companion-evaluation",
  "--volume", "${DataVolume}:/data",
  "--volume", "${CorpusDirectory}:/evaluation:ro",
  "--volume", "${OutputDirectory}:/output",
  "--entrypoint", "python",
  $Image,
  "-m", "voice_companion.evaluate_real_samples",
  "--manifest", "/evaluation/manifest.json",
  "--profile", $Profile,
  "--device", "cpu",
  "--compute-type", "int8",
  "--model-directory", "/data/models",
  "--command-model", "/data/models/Qwen3-4B-Q4_K_M.gguf",
  "--interpreter", "fact-dsl-v2",
  "--mode", "end-to-end",
  "--output", "/output/$OutputName"
)

Write-Host "Podman evaluation report: $OutputPath"
