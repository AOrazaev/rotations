from __future__ import annotations

import argparse
import json
import statistics
import time
from pathlib import Path

from .interpretation import LlamaCppCommandInterpreter


def load_corpus(path: Path) -> dict:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("Command corpus must be a JSON object.")
    context = payload.get("context")
    cases = payload.get("cases")
    if not isinstance(context, dict):
        raise ValueError("Command corpus requires an object context.")
    if not isinstance(cases, list) or not cases:
        raise ValueError("Command corpus requires a non-empty cases array.")
    for index, case in enumerate(cases):
        if not isinstance(case, dict):
            raise ValueError(f"Corpus case {index} must be an object.")
        if not isinstance(case.get("id"), str) or not case["id"]:
            raise ValueError(f"Corpus case {index} requires a non-empty id.")
        if not isinstance(case.get("transcript"), str) or not case["transcript"]:
            raise ValueError(
                f"Corpus case {index} requires a non-empty transcript."
            )
        if not isinstance(case.get("expectedEvents"), list):
            raise ValueError(
                f"Corpus case {index} expectedEvents must be an array."
            )
        if not isinstance(case.get("expectWarning"), bool):
            raise ValueError(
                f"Corpus case {index} expectWarning must be boolean."
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


def evaluate_corpus(corpus: dict, interpreter, progress=None) -> dict:
    results = []
    case_count = len(corpus["cases"])
    for index, case in enumerate(corpus["cases"]):
        if progress:
            progress(
                {
                    "stage": "case_started",
                    "caseIndex": index + 1,
                    "caseCount": case_count,
                    "caseId": case["id"],
                }
            )
        started = time.perf_counter()
        try:
            result = interpreter.interpret(
                case["transcript"],
                corpus["context"],
            )
            actual_events = semantic_events(result.events)
            warning_present = bool(result.warnings)
            results.append(
                {
                    "id": case["id"],
                    "transcript": case["transcript"],
                    "expectedEvents": case["expectedEvents"],
                    "actualEvents": actual_events,
                    "eventArrayExact": actual_events == case["expectedEvents"],
                    "expectedWarning": case["expectWarning"],
                    "actualWarnings": result.warnings,
                    "warningExpectationMet": (
                        warning_present == case["expectWarning"]
                    ),
                    "latencyMs": round(
                        (time.perf_counter() - started) * 1000
                    ),
                    "error": None,
                }
            )
        except Exception as error:
            results.append(
                {
                    "id": case["id"],
                    "transcript": case["transcript"],
                    "expectedEvents": case["expectedEvents"],
                    "actualEvents": None,
                    "eventArrayExact": False,
                    "expectedWarning": case["expectWarning"],
                    "actualWarnings": [],
                    "warningExpectationMet": False,
                    "latencyMs": round(
                        (time.perf_counter() - started) * 1000
                    ),
                    "error": {
                        "type": type(error).__name__,
                        "message": str(error),
                    },
                }
            )
        if progress:
            progress(
                {
                    "stage": "case_finished",
                    "caseIndex": index + 1,
                    "caseCount": case_count,
                    "caseId": case["id"],
                    "latencyMs": results[-1]["latencyMs"],
                    "passed": (
                        results[-1]["eventArrayExact"]
                        and results[-1]["warningExpectationMet"]
                        and results[-1]["error"] is None
                    ),
                }
            )

    latencies = [result["latencyMs"] for result in results]
    return {
        "formatVersion": 1,
        "model": interpreter.model_name,
        "caseResults": results,
        "summary": {
            "caseCount": len(results),
            "exactEventArrays": sum(
                result["eventArrayExact"] for result in results
            ),
            "warningExpectationsMet": sum(
                result["warningExpectationMet"] for result in results
            ),
            "errorCount": sum(
                result["error"] is not None for result in results
            ),
            "medianLatencyMs": round(statistics.median(latencies)),
            "maxLatencyMs": max(latencies),
        },
    }


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate transcript-to-proposal command interpretation."
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
    parser.add_argument("--gpu-layers", type=int, default=0)
    parser.add_argument("--output")
    args = parser.parse_args()

    try:
        corpus = load_corpus(Path(args.corpus))
    except (OSError, ValueError, json.JSONDecodeError) as error:
        parser.error(str(error))

    interpreter = LlamaCppCommandInterpreter(
        model_path=Path(args.model) if args.model else None,
        context_size=args.context_size,
        gpu_layers=args.gpu_layers,
    )
    report = evaluate_corpus(corpus, interpreter)
    encoded = json.dumps(report, indent=2)
    print(encoded)
    if args.output:
        Path(args.output).write_text(encoded + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
