from __future__ import annotations

import argparse
import ctypes
import importlib.metadata
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from . import __version__
from .evaluate_commands import evaluate_corpus, load_corpus
from .hardware import detect_hardware
from .interpretation import LlamaCppCommandInterpreter
from .profiles import resolve_profile
from .transcription import FasterWhisperTranscriber


def process_memory() -> dict:
    if platform.system() != "Windows":
        return {"workingSetBytes": None, "privateBytes": None}

    class ProcessMemoryCounters(ctypes.Structure):
        _fields_ = [
            ("cb", ctypes.c_ulong),
            ("pageFaultCount", ctypes.c_ulong),
            ("peakWorkingSetSize", ctypes.c_size_t),
            ("workingSetSize", ctypes.c_size_t),
            ("quotaPeakPagedPoolUsage", ctypes.c_size_t),
            ("quotaPagedPoolUsage", ctypes.c_size_t),
            ("quotaPeakNonPagedPoolUsage", ctypes.c_size_t),
            ("quotaNonPagedPoolUsage", ctypes.c_size_t),
            ("pagefileUsage", ctypes.c_size_t),
            ("peakPagefileUsage", ctypes.c_size_t),
            ("privateUsage", ctypes.c_size_t),
        ]

    counters = ProcessMemoryCounters()
    counters.cb = ctypes.sizeof(counters)
    get_current_process = ctypes.windll.kernel32.GetCurrentProcess
    get_current_process.restype = ctypes.c_void_p
    get_process_memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
    get_process_memory_info.argtypes = [
        ctypes.c_void_p,
        ctypes.c_void_p,
        ctypes.c_ulong,
    ]
    get_process_memory_info.restype = ctypes.c_int
    success = get_process_memory_info(
        get_current_process(),
        ctypes.byref(counters),
        counters.cb,
    )
    if not success:
        return {"workingSetBytes": None, "privateBytes": None}
    return {
        "workingSetBytes": int(counters.workingSetSize),
        "privateBytes": int(counters.privateUsage),
    }


def gpu_snapshot(label: str) -> dict:
    snapshot = {"label": label, "gpus": []}
    executable = shutil.which("nvidia-smi")
    if not executable:
        return snapshot
    completed = subprocess.run(
        [
            executable,
            "--query-gpu=name,memory.used,memory.total,temperature.gpu,"
            "utilization.gpu,pstate",
            "--format=csv,noheader,nounits",
        ],
        check=False,
        capture_output=True,
        text=True,
        timeout=10,
    )
    if completed.returncode != 0:
        snapshot["error"] = completed.stderr.strip() or "nvidia-smi failed"
        return snapshot
    for line in completed.stdout.splitlines():
        values = [value.strip() for value in line.split(",")]
        if len(values) != 6:
            continue
        snapshot["gpus"].append(
            {
                "name": values[0],
                "memoryUsedMiB": _integer_or_none(values[1]),
                "memoryTotalMiB": _integer_or_none(values[2]),
                "temperatureC": _integer_or_none(values[3]),
                "utilizationPercent": _integer_or_none(values[4]),
                "performanceState": values[5],
            }
        )
    return snapshot


def package_versions() -> dict:
    versions = {"bask-voice-companion": __version__}
    for package in (
        "ctranslate2",
        "faster-whisper",
        "llama-cpp-python",
    ):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    return versions


def summarize_rounds(rounds: list[dict]) -> dict:
    cases = [
        case
        for round_report in rounds
        for case in round_report["caseResults"]
    ]
    latencies = sorted(case["latencyMs"] for case in cases)
    total = len(cases)
    return {
        "commandCount": total,
        "exactEventArrays": sum(case["eventArrayExact"] for case in cases),
        "warningExpectationsMet": sum(
            case["warningExpectationMet"] for case in cases
        ),
        "errorCount": sum(case["error"] is not None for case in cases),
        "medianLatencyMs": round(statistics.median(latencies)),
        "p95LatencyMs": _percentile(latencies, 0.95),
        "maxLatencyMs": max(latencies),
        "passed": (
            all(case["eventArrayExact"] for case in cases)
            and all(case["warningExpectationMet"] for case in cases)
            and all(case["error"] is None for case in cases)
        ),
    }


def _percentile(values: list[int], percentile: float) -> int:
    index = max(
        0,
        min(len(values) - 1, math.ceil(len(values) * percentile) - 1),
    )
    return values[index]


def _integer_or_none(value: str) -> int | None:
    try:
        return int(value)
    except ValueError:
        return None


def _memory_delta(start: dict, end: dict, key: str) -> int | None:
    if start[key] is None or end[key] is None:
        return None
    return end[key] - start[key]


def run_validation(
    *,
    corpus_path: Path,
    model_path: Path | None,
    context_size: int,
    gpu_layers: int,
    transcription_profile: str,
    transcription_device: str | None,
    transcription_compute_type: str | None,
    repetitions: int,
    delay_between_rounds_seconds: int,
    source_revision: str | None,
) -> dict:
    corpus = load_corpus(corpus_path)
    interpreter = LlamaCppCommandInterpreter(
        model_path=model_path,
        context_size=context_size,
        gpu_layers=gpu_layers,
    )
    memory_samples = [
        {"label": "beforeWarmup", **process_memory()},
    ]
    gpu_samples = [gpu_snapshot("beforeWarmup")]
    transcriber = FasterWhisperTranscriber(
        resolve_profile(
            transcription_profile,
            device=transcription_device,
            compute_type=transcription_compute_type,
        )
    )
    transcription_warmup_started = time.perf_counter()
    transcriber.warmup()
    transcription_warmup_ms = round(
        (time.perf_counter() - transcription_warmup_started) * 1000
    )
    memory_samples.append(
        {"label": "afterTranscriptionWarmup", **process_memory()}
    )
    gpu_samples.append(gpu_snapshot("afterTranscriptionWarmup"))

    command_warmup_started = time.perf_counter()
    interpreter.warmup()
    command_warmup_ms = round(
        (time.perf_counter() - command_warmup_started) * 1000
    )
    memory_samples.append({"label": "afterCommandWarmup", **process_memory()})
    gpu_samples.append(gpu_snapshot("afterCommandWarmup"))

    rounds = []
    for index in range(repetitions):
        report = evaluate_corpus(corpus, interpreter)
        report["round"] = index + 1
        rounds.append(report)
        label = f"afterRound{index + 1}"
        memory_samples.append({"label": label, **process_memory()})
        gpu_samples.append(gpu_snapshot(label))
        if (
            delay_between_rounds_seconds > 0
            and index + 1 < repetitions
        ):
            time.sleep(delay_between_rounds_seconds)

    summary = summarize_rounds(rounds)
    after_warmup = memory_samples[2]
    final_memory = memory_samples[-1]
    summary["workingSetDeltaBytes"] = _memory_delta(
        after_warmup,
        final_memory,
        "workingSetBytes",
    )
    summary["privateMemoryDeltaBytes"] = _memory_delta(
        after_warmup,
        final_memory,
        "privateBytes",
    )
    return {
        "formatVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "sourceRevision": source_revision,
        "environment": {
            "python": platform.python_version(),
            "platform": platform.system(),
            "architecture": platform.machine(),
            "packages": package_versions(),
        },
        "hardware": detect_hardware(),
        "configuration": {
            "model": interpreter.model_name,
            "contextSize": context_size,
            "gpuLayers": gpu_layers,
            "transcription": {
                key: value
                for key, value in transcriber.metadata().items()
                if key != "modelDirectory"
            },
            "repetitions": repetitions,
            "delayBetweenRoundsSeconds": delay_between_rounds_seconds,
        },
        "warmup": {
            "transcriptionMs": transcription_warmup_ms,
            "commandInterpretationMs": command_warmup_ms,
            "totalMs": transcription_warmup_ms + command_warmup_ms,
        },
        "summary": summary,
        "memorySamples": memory_samples,
        "gpuSamples": gpu_samples,
        "rounds": rounds,
        "privacy": {
            "containsAudio": False,
            "containsToken": False,
            "containsModelPaths": False,
            "containsUserIdentity": False,
            "containsOnlyCuratedTranscripts": True,
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Run the standalone Checkpoint 4 gaming-PC validation."
    )
    parser.add_argument(
        "--corpus",
        default=str(
            Path(__file__).resolve().parents[2]
            / "evaluation"
            / "command-corpus-v1.json"
        ),
    )
    parser.add_argument("--model")
    parser.add_argument("--context-size", type=int, default=4096)
    parser.add_argument("--gpu-layers", type=int, default=-1)
    parser.add_argument(
        "--transcription-profile",
        choices=["lightweight", "balanced", "high_accuracy"],
        default="balanced",
    )
    parser.add_argument("--transcription-device")
    parser.add_argument("--transcription-compute-type")
    parser.add_argument("--repetitions", type=int, default=7)
    parser.add_argument("--delay-between-rounds-seconds", type=int, default=300)
    parser.add_argument("--source-revision")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    if args.repetitions <= 0:
        parser.error("--repetitions must be positive.")
    if args.delay_between_rounds_seconds < 0:
        parser.error("--delay-between-rounds-seconds cannot be negative.")

    try:
        report = run_validation(
            corpus_path=Path(args.corpus),
            model_path=Path(args.model) if args.model else None,
            context_size=args.context_size,
            gpu_layers=args.gpu_layers,
            transcription_profile=args.transcription_profile,
            transcription_device=args.transcription_device,
            transcription_compute_type=args.transcription_compute_type,
            repetitions=args.repetitions,
            delay_between_rounds_seconds=(
                args.delay_between_rounds_seconds
            ),
            source_revision=args.source_revision,
        )
    except Exception as error:
        error_message = str(error)
        replacements = {
            str(Path.home()): "%USERPROFILE%",
            os.environ.get("LOCALAPPDATA", ""): "%LOCALAPPDATA%",
        }
        if args.model:
            replacements[str(Path(args.model))] = Path(args.model).name
        for source, replacement in replacements.items():
            if source:
                error_message = error_message.replace(source, replacement)
        report = {
            "formatVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "sourceRevision": args.source_revision,
            "configuration": {
                "model": Path(args.model).name if args.model else None,
                "contextSize": args.context_size,
                "gpuLayers": args.gpu_layers,
                "transcriptionProfile": args.transcription_profile,
                "transcriptionDevice": args.transcription_device,
                "transcriptionComputeType": args.transcription_compute_type,
                "repetitions": args.repetitions,
                "delayBetweenRoundsSeconds": (
                    args.delay_between_rounds_seconds
                ),
            },
            "fatalError": {
                "type": type(error).__name__,
                "message": error_message,
            },
        }

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(report, indent=2)
    output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    if report.get("fatalError") or not report.get("summary", {}).get("passed"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
