from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.evaluate_commands import (
    evaluate_corpus,
    load_corpus,
    semantic_events,
)
from voice_companion.interpretation import InterpretationResult


class FakeInterpreter:
    model_name = "fixture-model"

    def interpret(self, transcript, context):
        if transcript == "ambiguous":
            return InterpretationResult(
                events=[],
                overall_confidence=None,
                warnings=["Ambiguous command."],
                model=self.model_name,
            )
        return InterpretationResult(
            events=[
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p7",
                    "confidence": 0.9,
                }
            ],
            overall_confidence=0.9,
            warnings=[],
            model=self.model_name,
        )


class CommandEvaluationTest(unittest.TestCase):
    def test_evaluates_exact_events_warnings_and_latency(self):
        corpus = {
            "context": {"roster": []},
            "cases": [
                {
                    "id": "assist",
                    "transcript": "assist",
                    "expectedEvents": [
                        {
                            "side": "team",
                            "type": "assist",
                            "playerId": "p7",
                        }
                    ],
                    "expectWarning": False,
                },
                {
                    "id": "ambiguous",
                    "transcript": "ambiguous",
                    "expectedEvents": [],
                    "expectWarning": True,
                },
            ],
        }

        report = evaluate_corpus(corpus, FakeInterpreter())

        self.assertEqual(report["summary"]["exactEventArrays"], 2)
        self.assertEqual(report["summary"]["warningExpectationsMet"], 2)
        self.assertEqual(report["summary"]["errorCount"], 0)

    def test_reports_case_progress(self):
        events = []
        corpus = {
            "context": {"roster": []},
            "cases": [
                {
                    "id": "assist",
                    "transcript": "assist",
                    "expectedEvents": [
                        {
                            "side": "team",
                            "type": "assist",
                            "playerId": "p7",
                        }
                    ],
                    "expectWarning": False,
                }
            ],
        }

        evaluate_corpus(corpus, FakeInterpreter(), progress=events.append)

        self.assertEqual(events[0]["stage"], "case_started")
        self.assertEqual(events[1]["stage"], "case_finished")
        self.assertTrue(events[1]["passed"])

    def test_load_corpus_rejects_missing_cases(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corpus.json"
            path.write_text(json.dumps({"context": {}}), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "cases"):
                load_corpus(path)

    def test_semantic_events_remove_only_confidence(self):
        self.assertEqual(
            semantic_events(
                [
                    {
                        "side": "opponent",
                        "type": "rebound",
                        "playerId": None,
                        "reboundKind": "defensive",
                        "confidence": 0.99,
                    }
                ]
            ),
            [
                {
                    "side": "opponent",
                    "type": "rebound",
                    "playerId": None,
                    "reboundKind": "defensive",
                }
            ],
        )


if __name__ == "__main__":
    unittest.main()
