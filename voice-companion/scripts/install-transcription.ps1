param(
  [ValidateSet("lightweight", "balanced", "high_accuracy")]
  [string[]]$Profile = @("balanced"),
  [switch]$AllProfiles,
  [string]$Python = "py",
  [string]$PackageIndexUrl = "https://pypi.org/simple",
  [string[]]$TrustedHost = @(),
  [string]$ModelDirectory = "",
  [int]$Retries = 10,
  [int]$TimeoutSeconds = 60,
  [switch]$ForceModelDownload
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$VirtualEnvironment = Join-Path $ProjectRoot ".venv"
$VirtualPython = Join-Path $VirtualEnvironment "Scripts\python.exe"
$PythonExecutable = $Python
if ($Python -eq "py") {
  $PythonExecutable = (& py -3.12 -c "import sys; print(sys.executable)").Trim()
  if ($LASTEXITCODE -ne 0 -or -not $PythonExecutable) {
    throw "Could not resolve the Python 3.12 executable through the py launcher."
  }
}

if ($AllProfiles) {
  $Profile = @("lightweight", "balanced", "high_accuracy")
}

if (-not (Test-Path $VirtualPython)) {
  Write-Host "Creating Python environment at $VirtualEnvironment..."
  & $PythonExecutable -m venv $VirtualEnvironment
  if ($LASTEXITCODE -ne 0) {
    throw @"
Could not create the Python 3.12 environment.

Install Python 3.12, or pass an explicit interpreter:
  -Python 'C:\Path\To\Python312\python.exe'
"@
  }
}

$VirtualVersion = & $VirtualPython -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($VirtualVersion -ne "3.12") {
  throw @"
The existing environment uses Python $VirtualVersion instead of Python 3.12.
Remove this disposable directory and rerun the installer:
  $VirtualEnvironment
"@
}

$pipArguments = @(
  "-m", "pip", "install",
  "--index-url", $PackageIndexUrl,
  "--retries", $Retries,
  "--timeout", $TimeoutSeconds,
  "--only-binary=:all:",
  "-r", (Join-Path $ProjectRoot "requirements-transcription.txt")
)
foreach ($hostName in $TrustedHost) {
  $pipArguments += @("--trusted-host", $hostName)
}

Write-Host "Installing faster-whisper into $VirtualEnvironment..."
& $VirtualPython @pipArguments
if ($LASTEXITCODE -ne 0) {
  throw @"
Could not install faster-whisper.

The configured package index was:
  $PackageIndexUrl

If a corporate package feed is unstable, retry with an approved mirror:
  -PackageIndexUrl <url> -TrustedHost <host>
"@
}

$downloadArguments = @("$PSScriptRoot\download_models.py")
foreach ($profileName in $Profile) {
  $downloadArguments += @("--profile", $profileName)
}
if ($ModelDirectory) {
  $downloadArguments += @("--model-directory", $ModelDirectory)
}
if ($ForceModelDownload) {
  $downloadArguments += "--force"
}

$env:HF_HUB_DISABLE_XET = "1"
Write-Host "Downloading transcription models for: $($Profile -join ', ')..."
& $VirtualPython @downloadArguments
if ($LASTEXITCODE -ne 0) {
  throw "Could not download the selected transcription models."
}

Write-Host ""
Write-Host "Transcription installation complete."
Write-Host "Start the companion with:"
Write-Host "  .\scripts\run.ps1 -Profile $($Profile[0])"
