from __future__ import annotations

import argparse
import json
import re
import statistics
import time
from pathlib import Path

from .profiles import default_model_directory, resolve_profile
from .transcription import FasterWhisperTranscriber


NUMBER_WORDS = {
    "zero": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
}
TENS_WORDS = {
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}


def normalize_transcript(value: str) -> str:
    tokens = re.findall(r"[a-z0-9]+", value.lower())
    normalized = []
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token in TENS_WORDS:
            number = TENS_WORDS[token]
            if index + 1 < len(tokens) and tokens[index + 1] in NUMBER_WORDS:
                next_number = NUMBER_WORDS[tokens[index + 1]]
                if 0 < next_number < 10:
                    number += next_number
                    index += 1
            normalized.append(str(number))
        elif token in NUMBER_WORDS:
            normalized.append(str(NUMBER_WORDS[token]))
        else:
            normalized.append(token)
        index += 1
    return " ".join(normalized)


def load_cases(audio_paths: list[str], manifest_path: str | None):
    cases = [{"audio": path, "expected": None} for path in audio_paths]
    if manifest_path:
        manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
        if not isinstance(manifest, list):
            raise ValueError("Evaluation manifest must be a JSON array.")
        for index, case in enumerate(manifest):
            if (
                not isinstance(case, dict)
                or not isinstance(case.get("audio"), str)
                or not case["audio"]
            ):
                raise ValueError(
                    f"Manifest case {index} must contain a non-empty audio path."
                )
            expected = case.get("expected")
            if expected is not None and not isinstance(expected, str):
                raise ValueError(
                    f"Manifest case {index} expected value must be a string or null."
                )
            cases.append({"audio": case["audio"], "expected": expected})
    if not cases:
        raise ValueError("Provide at least one audio path or --manifest.")
    return cases


def main():
    parser = argparse.ArgumentParser(
        description="Evaluate local faster-whisper transcription."
    )
    parser.add_argument("audio", nargs="*")
    parser.add_argument("--manifest")
    parser.add_argument(
        "--profile",
        choices=["lightweight", "balanced", "high_accuracy"],
        default="balanced",
    )
    parser.add_argument("--model")
    parser.add_argument("--device")
    parser.add_argument("--compute-type")
    parser.add_argument("--model-directory")
    parser.add_argument("--output")
    args = parser.parse_args()

    try:
        cases = load_cases(args.audio, args.manifest)
        profile = resolve_profile(
            args.profile,
            model=args.model,
            device=args.device,
            compute_type=args.compute_type,
        )
    except ValueError as error:
        parser.error(str(error))

    transcriber = FasterWhisperTranscriber(
        profile,
        model_directory=(
            Path(args.model_directory)
            if args.model_directory
            else default_model_directory()
        ),
    )
    results = []
    for case in cases:
        audio_path = Path(case["audio"]).resolve()
        if not audio_path.is_file():
            parser.error(f"Audio file does not exist: {audio_path}")
        started = time.perf_counter()
        result = transcriber.transcribe(
            audio_path.read_bytes(),
            audio_path.suffix or ".audio",
        )
        latency_ms = round((time.perf_counter() - started) * 1000)
        expected = case["expected"]
        results.append(
            {
                "audio": str(audio_path),
                "expected": expected,
                "transcript": result.text,
                "exactMatch": result.text == expected if expected is not None else None,
                "normalizedExactMatch": (
                    normalize_transcript(result.text)
                    == normalize_transcript(expected)
                    if expected is not None
                    else None
                ),
                "latencyMs": latency_ms,
                "audioDurationSeconds": result.audio_duration_seconds,
                "languageProbability": result.language_probability,
            }
        )

    measured_latencies = [result["latencyMs"] for result in results]
    scored = [
        result["normalizedExactMatch"]
        for result in results
        if result["normalizedExactMatch"] is not None
    ]
    report = {
        "profile": profile.name,
        "model": profile.model,
        "device": profile.device,
        "computeType": profile.compute_type,
        "modelDirectory": str(transcriber.model_directory),
        "cases": results,
        "summary": {
            "caseCount": len(results),
            "normalizedExactMatches": sum(scored),
            "scoredCaseCount": len(scored),
            "medianLatencyMs": round(statistics.median(measured_latencies)),
            "maxLatencyMs": max(measured_latencies),
        },
    }
    encoded = json.dumps(report, indent=2)
    print(encoded)
    if args.output:
        Path(args.output).write_text(encoded + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
