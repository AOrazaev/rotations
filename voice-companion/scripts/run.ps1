param(
  [string]$Token = $env:BASK_VOICE_TOKEN,
  [int]$Port = 8766
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Token) {
  $Token = [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
}

$env:PYTHONPATH = Join-Path $ProjectRoot "src"
python -m voice_companion --port $Port --token $Token
