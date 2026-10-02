from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.interpretation import (
    InvalidInterpretation,
    LlamaCppCommandInterpreter,
    validate_interpretation,
)


def context():
    return {
        "sideHint": None,
        "roster": [
            {"id": "p7", "jersey": "7", "name": "Alex"},
            {"id": "p13", "jersey": "13", "name": "Denis"},
        ],
        "currentLineupIds": ["p7", "p13"],
        "allowedEventTypes": [
            "shot",
            "rebound",
            "assist",
            "steal",
            "block",
            "turnover",
            "foul",
        ],
    }


class FakeLlama:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def create_chat_completion(self, **options):
        self.calls.append(options)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(self.payload),
                    }
                }
            ]
        }


class CommandInterpreterTest(unittest.TestCase):
    def test_returns_grounded_multi_event_proposal(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 2,
                    "made": True,
                    "shotDetails": {"phase": "transition"},
                    "confidence": 0.98,
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p7",
                    "confidence": 0.96,
                },
            ],
            "overallConfidence": 0.96,
            "warnings": [],
        }
        model = FakeLlama(payload)
        calls = []

        def factory(**options):
            calls.append(options)
            return model

        with tempfile.TemporaryDirectory() as directory:
            interpreter = LlamaCppCommandInterpreter(
                model_path=Path(directory) / "model.gguf",
                model_factory=factory,
            )
            first = interpreter.interpret(
                "Seven assist and thirteen makes two in transition",
                context(),
            )
            second = interpreter.interpret("Thirteen makes two", context())

        self.assertEqual(len(calls), 1)
        self.assertEqual(first.events[0]["playerId"], "p13")
        self.assertEqual(first.events[1]["type"], "assist")
        self.assertEqual(second.model, "model.gguf")
        request = model.calls[0]
        self.assertEqual(request["temperature"], 0)
        self.assertEqual(request["seed"], 0)
        self.assertEqual(
            request["response_format"]["schema"]["additionalProperties"],
            False,
        )
        self.assertIn('"jersey":"13"', request["messages"][1]["content"])
        self.assertIn("/no_think", request["messages"][0]["content"])

    def test_rejects_player_id_absent_from_roster(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "invented-player",
                    "confidence": 0.8,
                }
            ],
            "overallConfidence": 0.8,
            "warnings": [],
        }

        with self.assertRaisesRegex(InvalidInterpretation, "supplied roster"):
            validate_interpretation(payload, context(), "test-model")

    def test_rejects_event_type_not_allowed_by_request(self):
        request_context = context()
        request_context["allowedEventTypes"] = ["shot"]
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p7",
                    "confidence": 0.8,
                }
            ],
            "overallConfidence": 0.8,
            "warnings": [],
        }

        with self.assertRaisesRegex(InvalidInterpretation, "unsupported"):
            validate_interpretation(payload, request_context, "test-model")

    def test_accepts_ambiguous_command_as_warning_without_events(self):
        payload = {
            "events": [],
            "overallConfidence": None,
            "warnings": ["Player and shot value are ambiguous."],
        }

        result = validate_interpretation(payload, context(), "test-model")

        self.assertEqual(result.events, [])
        self.assertIsNone(result.overall_confidence)
        self.assertEqual(len(result.warnings), 1)

    def test_rejects_shot_without_required_details(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "confidence": 0.9,
                }
            ],
            "overallConfidence": 0.9,
            "warnings": [],
        }

        with self.assertRaisesRegex(InvalidInterpretation, "shotValue"):
            validate_interpretation(payload, context(), "test-model")

    def test_rejects_silently_omitted_spoken_event(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 2,
                    "made": True,
                    "confidence": 0.9,
                }
            ],
            "overallConfidence": 0.9,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        with self.assertRaisesRegex(InvalidInterpretation, "assist"):
            interpreter.interpret(
                "Seven assist and thirteen makes two",
                context(),
            )

    def test_normalizes_empty_shot_details_duplicates_and_order(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p7",
                    "confidence": 0.96,
                },
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 3,
                    "made": True,
                    "shotDetails": {},
                    "confidence": 0.98,
                },
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 3,
                    "made": True,
                    "shotDetails": {},
                    "confidence": 0.98,
                },
            ],
            "overallConfidence": 0.96,
            "warnings": [],
        }

        result = validate_interpretation(payload, context(), "test-model")

        self.assertEqual([event["type"] for event in result.events], ["shot", "assist"])
        self.assertNotIn("shotDetails", result.events[0])
        self.assertEqual(result.warnings, ["Removed 1 duplicate model event."])


if __name__ == "__main__":
    unittest.main()
