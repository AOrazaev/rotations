from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from .evaluate import normalize_transcript
from .fact_interpretation import FactDslCommandInterpreter
from .interpretation import LlamaCppCommandInterpreter
from .profiles import default_model_directory, resolve_profile
from .transcription import (
    FasterWhisperTranscriber,
    normalize_basketball_transcript,
)


def load_manifest(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("formatVersion") != 1:
        raise ValueError("Real-audio manifest must use formatVersion 1.")
    roster = payload.get("roster")
    allowed_types = payload.get("allowedEventTypes")
    cases = payload.get("cases")
    if not isinstance(roster, list) or not roster:
        raise ValueError("Real-audio manifest requires a non-empty roster.")
    if not isinstance(allowed_types, list) or not allowed_types:
        raise ValueError(
            "Real-audio manifest requires allowedEventTypes."
        )
    if not isinstance(cases, list) or not cases:
        raise ValueError("Real-audio manifest requires a non-empty cases array.")
    case_ids = set()
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"Real-audio case {index} must be an object.")
        case_id = case.get("id")
        if not isinstance(case_id, str) or not case_id or case_id in case_ids:
            raise ValueError(
                f"Real-audio case {index} requires a unique non-empty id."
            )
        case_ids.add(case_id)
        if not isinstance(case.get("audio"), str) or not case["audio"]:
            raise ValueError(f"Real-audio case {case_id} requires audio.")
        if (
            not isinstance(case.get("expectedTranscript"), str)
            or not case["expectedTranscript"]
        ):
            raise ValueError(
                f"Real-audio case {case_id} requires expectedTranscript."
            )
        if not isinstance(case.get("currentLineupIds"), list):
            raise ValueError(
                f"Real-audio case {case_id} requires currentLineupIds."
            )
        if not isinstance(case.get("expectedEvents"), list):
            raise ValueError(
                f"Real-audio case {case_id} requires expectedEvents."
            )
    return payload


def semantic_events(events: list[dict]) -> list[dict]:
    return [
        {
            key: value
            for key, value in event.items()
            if key != "confidence"
        }
        for event in events
    ]


def evaluate_samples(
    manifest_path: Path,
    manifest: dict,
    transcriber,
    interpreter,
    progress=None,
    mode: str = "both",
) -> dict:
    if mode not in {"end-to-end", "interpretation-only", "both"}:
        raise ValueError(f"Unsupported real-audio evaluation mode: {mode}.")
    run_end_to_end = mode in {"end-to-end", "both"}
    run_interpretation_only = mode in {"interpretation-only", "both"}
    results = []
    for index, case in enumerate(manifest["cases"]):
        if progress:
            progress({
                "stage": "case_started",
                "caseIndex": index + 1,
                "caseCount": len(manifest["cases"]),
                "caseId": case["id"],
            })
        audio_path = manifest_path.parent / case["audio"]
        context = {
            "sideHint": None,
            "roster": manifest["roster"],
            "currentLineupIds": case["currentLineupIds"],
            "allowedEventTypes": manifest["allowedEventTypes"],
        }
        result = {
            "id": case["id"],
            "audio": case["audio"],
            "expectedTranscript": case["expectedTranscript"],
            "expectedEvents": case["expectedEvents"],
            "rawTranscript": None,
            "normalizedTranscript": None,
            "rawTranscriptMatch": False,
            "normalizedTranscriptMatch": False,
            "actualEvents": None,
            "eventArrayExact": False,
            "warnings": [],
            "latencyMs": None,
            "error": None,
            "interpretationOnlyActualEvents": None,
            "interpretationOnlyEventArrayExact": False,
            "interpretationOnlyWarnings": [],
            "interpretationOnlyLatencyMs": None,
            "interpretationOnlyError": None,
            "failureCause": None,
        }
        if run_end_to_end:
            started = time.perf_counter()
            try:
                transcription = transcriber.transcribe(
                    audio_path.read_bytes(),
                    audio_path.suffix or ".audio",
                    channel_preference=case.get(
                        "audioChannelPreference",
                        "auto",
                    ),
                )
                result["rawTranscript"] = transcription.text
                normalized, normalization_warnings = (
                    normalize_basketball_transcript(
                        transcription.text,
                        context,
                    )
                )
                result["normalizedTranscript"] = normalized
                expected_normalized = normalize_transcript(
                    case["expectedTranscript"]
                )
                result["rawTranscriptMatch"] = (
                    normalize_transcript(transcription.text)
                    == expected_normalized
                )
                result["normalizedTranscriptMatch"] = (
                    normalize_transcript(normalized)
                    == expected_normalized
                )
                interpretation = interpreter.interpret(normalized, context)
                actual_events = semantic_events(interpretation.events)
                result["actualEvents"] = actual_events
                result["eventArrayExact"] = (
                    actual_events == case["expectedEvents"]
                )
                result["warnings"] = [
                    *normalization_warnings,
                    *interpretation.warnings,
                ]
            except Exception as error:
                result["error"] = {
                    "type": type(error).__name__,
                    "message": str(error),
                }
            result["latencyMs"] = round(
                (time.perf_counter() - started) * 1000
            )
        if run_interpretation_only:
            started = time.perf_counter()
            try:
                interpretation = interpreter.interpret(
                    case["expectedTranscript"],
                    context,
                )
                actual_events = semantic_events(interpretation.events)
                result["interpretationOnlyActualEvents"] = actual_events
                result["interpretationOnlyEventArrayExact"] = (
                    actual_events == case["expectedEvents"]
                )
                result["interpretationOnlyWarnings"] = interpretation.warnings
            except Exception as error:
                result["interpretationOnlyError"] = {
                    "type": type(error).__name__,
                    "message": str(error),
                }
            result["interpretationOnlyLatencyMs"] = round(
                (time.perf_counter() - started) * 1000
            )
        if (
            mode == "both"
            and not result["eventArrayExact"]
        ):
            result["failureCause"] = (
                "transcription"
                if result["interpretationOnlyEventArrayExact"]
                else "interpretation"
            )
        results.append(result)
        if progress:
            if mode == "end-to-end":
                passed = (
                    result["eventArrayExact"]
                    and result["error"] is None
                )
            elif mode == "interpretation-only":
                passed = (
                    result["interpretationOnlyEventArrayExact"]
                    and result["interpretationOnlyError"] is None
                )
            else:
                passed = (
                    result["eventArrayExact"]
                    and result["error"] is None
                    and result["interpretationOnlyEventArrayExact"]
                    and result["interpretationOnlyError"] is None
                )
            progress({
                "stage": "case_finished",
                "caseIndex": index + 1,
                "caseCount": len(manifest["cases"]),
                "caseId": case["id"],
                "passed": passed,
            })

    latencies = [
        result["latencyMs"]
        for result in results
        if result["latencyMs"] is not None
    ]
    interpretation_only_latencies = [
        result["interpretationOnlyLatencyMs"]
        for result in results
        if result["interpretationOnlyLatencyMs"] is not None
    ]
    return {
        "formatVersion": 1,
        "mode": mode,
        "transcriptionModel": getattr(transcriber, "model_name", None),
        "commandModel": interpreter.model_name,
        "interpreter": getattr(
            interpreter,
            "interpreter_name",
            type(interpreter).__name__,
        ),
        "caseResults": results,
        "summary": {
            "caseCount": len(results),
            "rawTranscriptMatches": (
                sum(result["rawTranscriptMatch"] for result in results)
                if run_end_to_end
                else None
            ),
            "normalizedTranscriptMatches": (
                sum(
                    result["normalizedTranscriptMatch"]
                    for result in results
                )
                if run_end_to_end
                else None
            ),
            "exactEventArrays": (
                sum(result["eventArrayExact"] for result in results)
                if run_end_to_end
                else None
            ),
            "interpretationOnlyExactEventArrays": (
                sum(
                    result["interpretationOnlyEventArrayExact"]
                    for result in results
                )
                if run_interpretation_only
                else None
            ),
            "errorCount": (
                sum(result["error"] is not None for result in results)
                if run_end_to_end
                else None
            ),
            "interpretationOnlyErrorCount": (
                sum(
                    result["interpretationOnlyError"] is not None
                    for result in results
                )
                if run_interpretation_only
                else None
            ),
            "medianLatencyMs": (
                round(statistics.median(latencies))
                if latencies
                else None
            ),
            "maxLatencyMs": max(latencies) if latencies else None,
            "medianInterpretationOnlyLatencyMs": (
                round(statistics.median(interpretation_only_latencies))
                if interpretation_only_latencies
                else None
            ),
            "maxInterpretationOnlyLatencyMs": (
                max(interpretation_only_latencies)
                if interpretation_only_latencies
                else None
            ),
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate curated real audio through transcription and interpretation."
    )
    parser.add_argument(
        "--manifest",
        default=str(
            Path(__file__).resolve().parents[2]
            / "evaluation"
            / "real-audio-v1"
            / "manifest.json"
        ),
    )
    parser.add_argument(
        "--profile",
        choices=["lightweight", "balanced", "high_accuracy"],
        default="balanced",
    )
    parser.add_argument("--transcription-model")
    parser.add_argument("--device")
    parser.add_argument("--compute-type")
    parser.add_argument("--model-directory")
    parser.add_argument("--command-model")
    parser.add_argument(
        "--interpreter",
        choices=["structured-json-v1", "fact-dsl-v2"],
        default="structured-json-v1",
    )
    parser.add_argument("--context-size", type=int, default=4096)
    parser.add_argument("--gpu-layers", type=int, default=0)
    parser.add_argument(
        "--mode",
        choices=["end-to-end", "interpretation-only", "both"],
        default="both",
    )
    parser.add_argument("--output")
    args = parser.parse_args()

    manifest_path = Path(args.manifest).resolve()
    try:
        manifest = load_manifest(manifest_path)
        profile = (
            resolve_profile(
                args.profile,
                model=args.transcription_model,
                device=args.device,
                compute_type=args.compute_type,
            )
            if args.mode != "interpretation-only"
            else None
        )
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))

    transcriber = (
        FasterWhisperTranscriber(
            profile,
            model_directory=(
                Path(args.model_directory)
                if args.model_directory
                else default_model_directory()
            ),
        )
        if profile is not None
        else None
    )
    interpreter_type = (
        FactDslCommandInterpreter
        if args.interpreter == "fact-dsl-v2"
        else LlamaCppCommandInterpreter
    )
    interpreter = interpreter_type(
        model_path=(
            Path(args.command_model)
            if args.command_model
            else None
        ),
        context_size=args.context_size,
        gpu_layers=args.gpu_layers,
    )
    report = evaluate_samples(
        manifest_path,
        manifest,
        transcriber,
        interpreter,
        mode=args.mode,
    )
    encoded = json.dumps(report, indent=2)
    print(encoded)
    if args.output:
        Path(args.output).write_text(encoded + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
