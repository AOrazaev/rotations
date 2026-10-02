param(
  [string]$PackageIndexUrl = "",
  [string]$TrustedHost = "",
  [string]$WheelIndexUrl = "https://abetlen.github.io/llama-cpp-python/whl/cpu",
  [ValidateSet("qwen3", "phi4mini")]
  [string]$ModelCandidate = "qwen3",
  [switch]$SkipModelDownload,
  [switch]$ForceModelDownload
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VirtualEnvironment = Join-Path $ProjectRoot ".venv"
$VirtualPython = Join-Path $VirtualEnvironment "Scripts\python.exe"

if (-not (Test-Path $VirtualPython)) {
  $Python312 = (& py -3.12 -c "import sys; print(sys.executable)").Trim()
  if (-not $Python312 -or -not (Test-Path $Python312)) {
    throw "Python 3.12 is required. Install it and ensure 'py -3.12' resolves."
  }
  & $Python312 -m venv $VirtualEnvironment
}

$pipArguments = @(
  "-m", "pip", "install",
  "huggingface-hub>=0.34,<2",
  "llama-cpp-python==0.3.35",
  "--extra-index-url", $WheelIndexUrl
)
if ($PackageIndexUrl) {
  $pipArguments += @("--index-url", $PackageIndexUrl)
}
if ($TrustedHost) {
  $pipArguments += @("--trusted-host", $TrustedHost)
}

& $VirtualPython @pipArguments
if ($LASTEXITCODE -ne 0) {
  throw "Command interpretation dependency installation failed."
}

if (-not $SkipModelDownload) {
  $downloadArguments = @(
    (Join-Path $PSScriptRoot "download_command_model.py"),
    "--candidate", $ModelCandidate
  )
  if ($ForceModelDownload) {
    $downloadArguments += "--force"
  }
  & $VirtualPython @downloadArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command model download failed."
  }
}

Write-Host "Command interpretation runtime is installed."
