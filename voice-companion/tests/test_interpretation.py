from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.interpretation import (
    create_interpreter,
    InvalidInterpretation,
    LlamaCppCommandInterpreter,
    validate_interpretation,
)
from voice_companion.fact_interpretation import (
    FactDslCommandInterpreter,
    parse_fact_dsl,
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


class FakeTextLlama:
    def __init__(self, content):
        self.content = content
        self.calls = []

    def create_chat_completion(self, **options):
        self.calls.append(options)
        return {
            "choices": [
                {
                    "message": {
                        "content": self.content,
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
        self.assertIn(
            "Opponent misses two pointer. Number 7 defensive rebound.",
            request["messages"][1]["content"],
        )
        self.assertIn("/no_think", request["messages"][0]["content"])
        self.assertIn(
            "Resolve each clause independently",
            request["messages"][0]["content"],
        )

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

    def test_corrects_explicit_assister_and_scorer_attribution(self):
        request_context = {
            **context(),
            "roster": [
                {"id": "p5", "jersey": "5", "name": "Vlad"},
                {"id": "p13", "jersey": "13", "name": "Dmytro"},
            ],
            "currentLineupIds": ["p5", "p13"],
        }
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p5",
                    "shotValue": 3,
                    "made": True,
                    "shotDetails": {"phase": "transition"},
                    "confidence": 0.98,
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p5",
                    "confidence": 0.98,
                },
            ],
            "overallConfidence": 0.98,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number five assist number 13 makes three pointer",
            request_context,
        )

        self.assertEqual(result.events[0]["playerId"], "p13")
        self.assertEqual(result.events[1]["playerId"], "p5")
        self.assertNotIn("shotDetails", result.events[0])
        self.assertIn(
            "Corrected shot attribution to jersey 13 from the explicit transcript.",
            result.warnings,
        )
        self.assertIn(
            "Removed unspoken shot phase 'transition'.",
            result.warnings,
        )

    def test_does_not_ground_opponent_number_to_team_roster(self):
        payload = {
            "events": [
                {
                    "side": "opponent",
                    "type": "shot",
                    "playerId": None,
                    "shotValue": 3,
                    "made": True,
                    "confidence": 0.95,
                }
            ],
            "overallConfidence": 0.95,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Opponent number seven makes three pointer",
            context(),
        )

        self.assertEqual(result.events[0]["side"], "opponent")
        self.assertIsNone(result.events[0]["playerId"])
        self.assertEqual(result.warnings, [])

    def test_interprets_opponent_timeout_without_player(self):
        payload = {
            "events": [
                {
                    "side": "opponent",
                    "type": "timeout",
                    "playerId": None,
                    "confidence": 0.99,
                }
            ],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret("Opponent timeout", {
            **context(),
            "allowedEventTypes": [*context()["allowedEventTypes"], "timeout"],
        })

        self.assertEqual(result.events, payload["events"])
        self.assertEqual(result.warnings, [])
        self.assertIn(
            '"transcript":"Opponent timeout"',
            model.calls[0]["messages"][1]["content"],
        )

    def test_recovers_grounded_four_event_command_from_invalid_model_ids(self):
        request_context = {
            **context(),
            "roster": [
                {"id": "p40", "jersey": "40", "name": "Bek"},
                {"id": "p13", "jersey": "13", "name": "Dmytro"},
            ],
            "currentLineupIds": ["p40", "p13"],
        }
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p40",
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": False,
                    "shotDetails": {"phase": "transition"},
                },
                {
                    "side": "team",
                    "type": "rebound",
                    "playerId": "malformed-player-id",
                    "confidence": 0.99,
                    "reboundKind": "defensive",
                },
                {
                    "side": "opponent",
                    "type": "steal",
                    "playerId": None,
                    "confidence": 0.99,
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p13",
                    "confidence": 0.99,
                },
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": True,
                    "shotDetails": {"phase": "transition"},
                },
            ],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number 40 missed two pointer defensive rebound by opponent "
            "steal by 13. 13 makes two points in transition",
            request_context,
        )

        self.assertEqual(
            [
                (event["type"], event["side"], event["playerId"])
                for event in result.events
            ],
            [
                ("shot", "team", "p40"),
                ("rebound", "opponent", None),
                ("steal", "team", "p13"),
                ("shot", "team", "p13"),
            ],
        )
        self.assertNotIn("shotDetails", result.events[0])
        self.assertEqual(
            result.events[3]["shotDetails"],
            {"phase": "transition"},
        )
        self.assertIn("Removed 1 unspoken model event.", result.warnings)

    def test_interprets_substitution_from_lineup_without_loading_model(self):
        request_context = {
            **context(),
            "currentLineupIds": ["p13"],
            "allowedEventTypes": [
                *context()["allowedEventTypes"],
                "substitution",
            ],
        }
        calls = []
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: calls.append(options),
        )

        result = interpreter.interpret(
            "Number 7 subs for 13",
            request_context,
        )

        self.assertEqual(calls, [])
        self.assertEqual(
            result.events,
            [{
                "side": "team",
                "type": "substitution",
                "playerId": None,
                "playerInId": "p7",
                "playerOutId": "p13",
                "confidence": 0.99,
            }],
        )

    def test_rejects_mixed_or_lineup_inconsistent_substitution(self):
        request_context = {
            **context(),
            "currentLineupIds": ["p13"],
            "allowedEventTypes": [
                *context()["allowedEventTypes"],
                "substitution",
            ],
        }
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: FakeLlama({}),
        )

        with self.assertRaisesRegex(InvalidInterpretation, "substitution-only"):
            interpreter.interpret(
                "Number 7 subs for 13 and makes two",
                request_context,
            )
        with self.assertRaisesRegex(InvalidInterpretation, "not on court"):
            interpreter.interpret(
                "Number 13 subs for 7",
                request_context,
            )

    def test_recovers_explicit_opponent_foul_omitted_by_model(self):
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": False,
                    "shotDetails": {"phase": "transition"},
                }
            ],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number 13 misses two pointer in transition. Opponent foul.",
            context(),
        )

        self.assertEqual(
            [
                (event["type"], event["side"], event["playerId"])
                for event in result.events
            ],
            [
                ("shot", "team", "p13"),
                ("foul", "opponent", None),
            ],
        )
        self.assertIn(
            "Recovered 1 explicitly spoken foul event omitted by the command model.",
            result.warnings,
        )

    def test_recovers_two_word_turn_over_omitted_by_model(self):
        request_context = {
            **context(),
            "roster": [
                {"id": "p7", "jersey": "7", "name": "Aman"},
                {"id": "p70", "jersey": "70", "name": "Yedil"},
            ],
            "currentLineupIds": ["p7", "p70"],
        }
        payload = {
            "events": [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p7",
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": False,
                    "shotDetails": {"phase": "transition"},
                },
                {
                    "side": "team",
                    "type": "rebound",
                    "playerId": "p70",
                    "confidence": 0.99,
                    "reboundKind": "offensive",
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p70",
                    "confidence": 0.99,
                },
            ],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number seven misses two pointer. Number seventy offensive rebound. "
            "Number seventy turn over.",
            request_context,
        )

        self.assertEqual(
            [
                (event["type"], event["playerId"])
                for event in result.events
            ],
            [
                ("shot", "p7"),
                ("rebound", "p70"),
                ("turnover", "p70"),
            ],
        )
        self.assertNotIn("shotDetails", result.events[0])
        self.assertIn("Removed 1 unspoken model event.", result.warnings)
        self.assertIn(
            "Recovered 1 explicitly spoken turnover event omitted by the "
            "command model.",
            result.warnings,
        )

    def test_recovers_explicit_rebound_kind_before_validation(self):
        request_context = {
            **context(),
            "roster": [
                {"id": "p60", "jersey": "60", "name": "Valya"},
            ],
            "currentLineupIds": ["p60"],
        }
        payload = {
            "events": [{
                "side": "team",
                "type": "rebound",
                "playerId": "p60",
                "confidence": 0.99,
            }],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number 60 defensive rebound.",
            request_context,
        )

        self.assertEqual(
            result.events,
            [{
                "side": "team",
                "type": "rebound",
                "playerId": "p60",
                "confidence": 0.99,
                "reboundKind": "defensive",
            }],
        )
        self.assertIn(
            "Corrected rebound kind to defensive from the explicit transcript.",
            result.warnings,
        )

    def test_removes_shot_details_from_non_shot_multi_event_command(self):
        request_context = {
            **context(),
            "roster": [
                {"id": "p13", "jersey": "13", "name": "Dmytro"},
                {"id": "p60", "jersey": "60", "name": "Valya"},
            ],
            "currentLineupIds": ["p13", "p60"],
        }
        payload = {
            "events": [
                {
                    "side": "opponent",
                    "type": "shot",
                    "playerId": None,
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": False,
                },
                {
                    "side": "team",
                    "type": "rebound",
                    "playerId": "p60",
                    "confidence": 0.99,
                    "reboundKind": "defensive",
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p13",
                    "confidence": 0.99,
                    "shotDetails": {"phase": "transition"},
                },
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p60",
                    "confidence": 0.99,
                    "shotValue": 2,
                    "made": True,
                    "shotDetails": {"phase": "transition"},
                },
            ],
            "overallConfidence": 0.99,
            "warnings": [],
        }
        model = FakeLlama(payload)
        interpreter = LlamaCppCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Opponent misses two pointer. Number sixty defensive rebound. "
            "Number thirteen assist. Number sixty makes two points in transition.",
            request_context,
        )

        self.assertNotIn("shotDetails", result.events[2])
        self.assertEqual(
            result.events[3]["shotDetails"],
            {"phase": "transition"},
        )
        self.assertIn(
            "Removed shot details from non-shot assist event.",
            result.warnings,
        )

    def test_rejects_team_player_on_opponent_event(self):
        payload = {
            "events": [
                {
                    "side": "opponent",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 1,
                    "made": False,
                    "confidence": 0.9,
                }
            ],
            "overallConfidence": 0.9,
            "warnings": [],
        }

        with self.assertRaisesRegex(InvalidInterpretation, "playerId null"):
            validate_interpretation(payload, context(), "test-model")

    def test_accepts_team_level_opponent_statistics(self):
        payload = {
            "events": [
                {
                    "side": "opponent",
                    "type": "rebound",
                    "playerId": None,
                    "reboundKind": "defensive",
                    "confidence": 0.95,
                },
                {
                    "side": "opponent",
                    "type": "shot",
                    "playerId": None,
                    "shotValue": 1,
                    "made": False,
                    "confidence": 0.95,
                },
            ],
            "overallConfidence": 0.95,
            "warnings": [],
        }

        result = validate_interpretation(payload, context(), "test-model")

        self.assertEqual(result.events[0]["side"], "opponent")
        self.assertIsNone(result.events[1]["playerId"])

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


class FactDslCommandInterpreterTest(unittest.TestCase):
    def test_parses_compact_facts_into_validated_events(self):
        payload = parse_fact_dsl(
            "\n".join([
                "<think>",
                "",
                "</think>",
                "SHOT TEAM 13 2 MADE TRANSITION",
                "ASSIST TEAM 7",
                "FOUL OPPONENT -",
            ]),
            context(),
        )

        result = validate_interpretation(payload, context(), "test-model")

        self.assertEqual(
            [
                {
                    key: value
                    for key, value in event.items()
                    if key != "confidence"
                }
                for event in result.events
            ],
            [
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 2,
                    "made": True,
                    "shotDetails": {"phase": "transition"},
                },
                {
                    "side": "team",
                    "type": "assist",
                    "playerId": "p7",
                },
                {
                    "side": "opponent",
                    "type": "foul",
                    "playerId": None,
                },
            ],
        )

    def test_interprets_with_fact_prompt_and_short_output_limit(self):
        model = FakeTextLlama(
            "SHOT TEAM 13 2 MADE TRANSITION\nASSIST TEAM 7"
        )
        interpreter = FactDslCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Seven assist and thirteen makes two in transition",
            context(),
        )

        self.assertEqual(
            [event["type"] for event in result.events],
            ["shot", "assist"],
        )
        self.assertEqual(result.events[0]["playerId"], "p13")
        self.assertEqual(result.events[1]["playerId"], "p7")
        request = model.calls[0]
        self.assertEqual(request["max_tokens"], 256)
        self.assertNotIn("response_format", request)
        self.assertIn("compact fact language", request["messages"][0]["content"])
        self.assertIn(
            '"jersey":"13","onCourt":true',
            request["messages"][1]["content"],
        )

    def test_rejects_invalid_or_unknown_fact_jerseys(self):
        with self.assertRaisesRegex(InvalidInterpretation, "Invalid fact"):
            parse_fact_dsl("SHOT TEAM 99 2 MADE -", context())
        with self.assertRaisesRegex(InvalidInterpretation, "Invalid fact"):
            parse_fact_dsl("SHOT TEAM 13 2 MAYBE -", context())

    def test_aligns_reordered_and_extra_facts_to_transcript(self):
        request_context = {
            **context(),
            "roster": [
                *context()["roster"],
                {"id": "p40", "jersey": "40", "name": "Forty"},
            ],
            "currentLineupIds": ["p13", "p40"],
        }
        model = FakeTextLlama(
            "\n".join([
                "REBOUND OPPONENT 40 DEFENSIVE",
                "STEAL OPPONENT 13",
                "SHOT OPPONENT - 2 MISSED -",
                "REBOUND TEAM 13 DEFENSIVE",
                "SHOT TEAM 13 2 MADE TRANSITION",
            ])
        )
        interpreter = FactDslCommandInterpreter(
            model_path=Path("model.gguf"),
            model_factory=lambda **options: model,
        )

        result = interpreter.interpret(
            "Number 40 missed two pointer defensive rebound by opponent "
            "steal by 13. 13 makes two points in transition.",
            request_context,
        )

        self.assertEqual(
            [
                (event["type"], event["side"], event["playerId"])
                for event in result.events
            ],
            [
                ("shot", "team", "p40"),
                ("rebound", "opponent", None),
                ("steal", "team", "p13"),
                ("shot", "team", "p13"),
            ],
        )
        self.assertFalse(result.events[0]["made"])
        self.assertTrue(result.events[3]["made"])
        self.assertIn("Removed 1 extra DSL fact.", result.warnings)

    def test_factory_selects_fact_dsl_without_changing_default(self):
        structured = create_interpreter(
            "llama-cpp",
            model_path=Path("model.gguf"),
        )
        facts = create_interpreter(
            "llama-cpp-fact-dsl",
            model_path=Path("model.gguf"),
        )

        self.assertIsInstance(structured, LlamaCppCommandInterpreter)
        self.assertNotIsInstance(structured, FactDslCommandInterpreter)
        self.assertIsInstance(facts, FactDslCommandInterpreter)


if __name__ == "__main__":
    unittest.main()
