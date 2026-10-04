from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.evaluate_real_samples import (
    evaluate_samples,
    load_manifest,
)
from voice_companion.interpretation import InterpretationResult


class FixtureTranscriber:
    model_name = "fixture-transcriber"

    def transcribe(self, audio, suffix, *, channel_preference="auto"):
        return SimpleNamespace(text=audio.decode("utf-8"))


class FixtureInterpreter:
    model_name = "fixture-interpreter"

    def interpret(self, transcript, context):
        return InterpretationResult(
            events=[{
                "side": "team",
                "type": "shot",
                "playerId": "p50",
                "shotValue": 2,
                "made": False,
                "confidence": 0.99,
            }],
            overall_confidence=0.99,
            warnings=[],
            model=self.model_name,
        )


class TranscriptSensitiveInterpreter:
    model_name = "fixture-interpreter"

    def interpret(self, transcript, context):
        player_id = "p70" if "seventy" in transcript.lower() else "p7"
        return InterpretationResult(
            events=[{
                "side": "team",
                "type": "shot",
                "playerId": player_id,
                "shotValue": 2,
                "made": True,
                "confidence": 0.99,
            }],
            overall_confidence=0.99,
            warnings=[],
            model=self.model_name,
        )


class RealSampleEvaluationTest(unittest.TestCase):
    def test_committed_manifest_references_present_audio(self):
        manifest_path = (
            PROJECT_ROOT
            / "evaluation"
            / "real-audio-v1"
            / "manifest.json"
        )

        manifest = load_manifest(manifest_path)

        self.assertEqual(len(manifest["cases"]), 27)
        for case in manifest["cases"]:
            self.assertTrue((manifest_path.parent / case["audio"]).is_file())

    def test_evaluates_transcription_normalization_and_events(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.webm").write_bytes(
                b"Fifteen misses two pointer."
            )
            manifest_path = root / "manifest.json"
            manifest = {
                "formatVersion": 1,
                "roster": [
                    {"id": "p50", "jersey": "50", "name": "Player 50"}
                ],
                "allowedEventTypes": ["shot"],
                "cases": [{
                    "id": "fifty",
                    "audio": "sample.webm",
                    "expectedTranscript": "Fifty misses two pointer.",
                    "currentLineupIds": ["p50"],
                    "expectedEvents": [{
                        "side": "team",
                        "type": "shot",
                        "playerId": "p50",
                        "shotValue": 2,
                        "made": False,
                    }],
                }],
            }
            manifest_path.write_text(
                json.dumps(manifest),
                encoding="utf-8",
            )

            loaded = load_manifest(manifest_path)
            report = evaluate_samples(
                manifest_path,
                loaded,
                FixtureTranscriber(),
                FixtureInterpreter(),
            )

        case = report["caseResults"][0]
        self.assertFalse(case["rawTranscriptMatch"])
        self.assertTrue(case["normalizedTranscriptMatch"])
        self.assertTrue(case["eventArrayExact"])
        self.assertTrue(case["interpretationOnlyEventArrayExact"])
        self.assertIsNone(case["failureCause"])
        self.assertEqual(report["summary"]["errorCount"], 0)
        self.assertEqual(
            report["summary"]["interpretationOnlyExactEventArrays"],
            1,
        )
        self.assertIn("Normalized jersey", case["warnings"][0])

    def test_classifies_failure_when_gold_transcript_interpretation_passes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "sample.webm").write_bytes(
                b"Number seven two makes two pointer."
            )
            manifest_path = root / "manifest.json"
            manifest = {
                "formatVersion": 1,
                "roster": [
                    {"id": "p7", "jersey": "7", "name": "Player 7"},
                    {"id": "p70", "jersey": "70", "name": "Player 70"},
                ],
                "allowedEventTypes": ["shot"],
                "cases": [{
                    "id": "seventy",
                    "audio": "sample.webm",
                    "expectedTranscript": "Number seventy makes two pointer.",
                    "currentLineupIds": ["p7", "p70"],
                    "expectedEvents": [{
                        "side": "team",
                        "type": "shot",
                        "playerId": "p70",
                        "shotValue": 2,
                        "made": True,
                    }],
                }],
            }
            manifest_path.write_text(
                json.dumps(manifest),
                encoding="utf-8",
            )

            report = evaluate_samples(
                manifest_path,
                manifest,
                FixtureTranscriber(),
                TranscriptSensitiveInterpreter(),
            )

        case = report["caseResults"][0]
        self.assertFalse(case["eventArrayExact"])
        self.assertTrue(case["interpretationOnlyEventArrayExact"])
        self.assertEqual(case["failureCause"], "transcription")

    def test_interpretation_only_mode_does_not_require_transcriber(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest_path = root / "manifest.json"
            manifest = {
                "formatVersion": 1,
                "roster": [
                    {"id": "p50", "jersey": "50", "name": "Player 50"}
                ],
                "allowedEventTypes": ["shot"],
                "cases": [{
                    "id": "fifty",
                    "audio": "missing.webm",
                    "expectedTranscript": "Fifty misses two pointer.",
                    "currentLineupIds": ["p50"],
                    "expectedEvents": [{
                        "side": "team",
                        "type": "shot",
                        "playerId": "p50",
                        "shotValue": 2,
                        "made": False,
                    }],
                }],
            }

            report = evaluate_samples(
                manifest_path,
                manifest,
                None,
                FixtureInterpreter(),
                mode="interpretation-only",
            )

        case = report["caseResults"][0]
        self.assertIsNone(case["rawTranscript"])
        self.assertIsNone(case["latencyMs"])
        self.assertTrue(case["interpretationOnlyEventArrayExact"])
        self.assertIsNone(report["summary"]["exactEventArrays"])

    def test_rejects_duplicate_case_ids(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "manifest.json"
            case = {
                "id": "duplicate",
                "audio": "sample.webm",
                "expectedTranscript": "test",
                "currentLineupIds": [],
                "expectedEvents": [],
            }
            path.write_text(
                json.dumps({
                    "formatVersion": 1,
                    "roster": [{"id": "p1", "jersey": "1", "name": "P"}],
                    "allowedEventTypes": ["shot"],
                    "cases": [case, case],
                }),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "unique"):
                load_manifest(path)


if __name__ == "__main__":
    unittest.main()
