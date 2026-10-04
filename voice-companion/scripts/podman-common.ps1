function Get-BaskPodman {
  $command = Get-Command "podman.exe" -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "RedHat\Podman\podman.exe"),
    (Join-Path $env:ProgramFiles "Podman\podman.exe")
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  throw @"
Podman Desktop is installed, but the Podman engine CLI is unavailable.

Complete the Podman engine/machine setup in Podman Desktop, then open a new
PowerShell window and verify:
  podman version
  podman machine list
"@
}

function Invoke-BaskPodman {
  param(
    [Parameter(Mandatory)]
    [string[]]$Arguments,
    [int[]]$SuccessExitCodes = @(0)
  )

  $podman = Get-BaskPodman
  & $podman @Arguments
  if ($LASTEXITCODE -notin $SuccessExitCodes) {
    throw "Podman command failed with exit code $LASTEXITCODE."
  }
}

function Get-BaskPodmanMachine {
  $podman = Get-BaskPodman
  $machineJson = & $podman machine inspect
  if ($LASTEXITCODE -ne 0) {
    throw "Could not inspect the active Podman machine."
  }
  $machines = @(($machineJson -join "`n") | ConvertFrom-Json)
  if ($machines.Count -ne 1 -or $machines[0].State -ne "running") {
    throw "Exactly one running Podman machine is required."
  }
  return $machines[0]
}

function Assert-BaskPodmanGpu {
  param(
    [Parameter(Mandatory)]
    [string]$Image
  )

  Write-Host "Verifying CDI GPU access and CUDA inference libraries..."
  Invoke-BaskPodman -Arguments @(
    "run", "--rm",
    "--cgroups=disabled",
    "--device", "nvidia.com/gpu=all",
    "--entrypoint", "python",
    $Image,
    "-c",
    "import ctranslate2, llama_cpp; devices=ctranslate2.get_cuda_device_count(); offload=llama_cpp.llama_supports_gpu_offload(); print(f'CUDA devices: {devices}; llama.cpp GPU offload: {offload}'); raise SystemExit(0 if devices > 0 and offload else 1)"
  )
}

function Start-BaskPodmanLoopbackTunnel {
  param(
    [Parameter(Mandatory)]
    [int]$Port
  )

  $ssh = Get-Command "ssh.exe" -ErrorAction SilentlyContinue
  if (-not $ssh) {
    throw "Windows OpenSSH Client is required for Podman loopback forwarding."
  }

  $machine = Get-BaskPodmanMachine

  $arguments = @(
    "-N",
    "-T",
    "-o", "ExitOnForwardFailure=yes",
    "-o", "ServerAliveInterval=30",
    "-o", "ServerAliveCountMax=3",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=NUL",
    "-i", $machine.SSHConfig.IdentityPath,
    "-p", [string]$machine.SSHConfig.Port,
    "-L", "127.0.0.1:${Port}:127.0.0.1:${Port}",
    "$($machine.SSHConfig.RemoteUsername)@127.0.0.1"
  )
  $process = Start-Process `
    -FilePath $ssh.Source `
    -ArgumentList $arguments `
    -PassThru `
    -WindowStyle Hidden
  Start-Sleep -Milliseconds 500
  if ($process.HasExited) {
    throw "Could not establish the Podman machine loopback tunnel."
  }
  return $process
}
