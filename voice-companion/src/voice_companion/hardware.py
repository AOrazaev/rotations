from __future__ import annotations

import ctypes
import os
import platform
import shutil
import subprocess


def detect_hardware() -> dict:
    logical_processors = os.cpu_count() or 1
    memory_bytes = _total_memory_bytes()
    cuda_devices = _cuda_device_count()
    nvidia_gpus = _nvidia_gpu_names()
    return {
        "platform": platform.system(),
        "architecture": platform.machine(),
        "cpu": platform.processor() or "unknown",
        "logicalProcessors": logical_processors,
        "memoryBytes": memory_bytes,
        "cudaDeviceCount": cuda_devices,
        "nvidiaGpus": nvidia_gpus,
        "recommendedProfile": _recommended_profile(
            logical_processors,
            memory_bytes,
            cuda_devices,
        ),
    }


def _recommended_profile(
    logical_processors: int,
    memory_bytes: int | None,
    cuda_devices: int,
) -> str:
    memory_gb = (memory_bytes or 0) / (1024**3)
    if cuda_devices > 0 and memory_gb >= 16:
        return "high_accuracy"
    if logical_processors >= 8 and memory_gb >= 16:
        return "balanced"
    return "lightweight"


def _total_memory_bytes() -> int | None:
    if platform.system() == "Windows":
        class MemoryStatus(ctypes.Structure):
            _fields_ = [
                ("length", ctypes.c_ulong),
                ("memoryLoad", ctypes.c_ulong),
                ("totalPhysical", ctypes.c_ulonglong),
                ("availablePhysical", ctypes.c_ulonglong),
                ("totalPageFile", ctypes.c_ulonglong),
                ("availablePageFile", ctypes.c_ulonglong),
                ("totalVirtual", ctypes.c_ulonglong),
                ("availableVirtual", ctypes.c_ulonglong),
                ("availableExtendedVirtual", ctypes.c_ulonglong),
            ]

        status = MemoryStatus()
        status.length = ctypes.sizeof(MemoryStatus)
        if ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            return int(status.totalPhysical)
        return None
    if hasattr(os, "sysconf"):
        try:
            return int(os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES"))
        except (OSError, ValueError):
            return None
    return None


def _cuda_device_count() -> int:
    try:
        import ctranslate2

        return int(ctranslate2.get_cuda_device_count())
    except (ImportError, RuntimeError, OSError, ValueError):
        return 0


def _nvidia_gpu_names() -> list[str]:
    executable = shutil.which("nvidia-smi")
    if not executable:
        return []
    try:
        completed = subprocess.run(
            [
                executable,
                "--query-gpu=name",
                "--format=csv,noheader",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except (OSError, subprocess.TimeoutExpired):
        return []
    if completed.returncode != 0:
        return []
    return [
        line.strip()
        for line in completed.stdout.splitlines()
        if line.strip()
    ]
