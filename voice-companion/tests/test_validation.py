from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.validation import RequestValidationError, validate_context


def valid_context():
    return {
        "protocolVersion": 1,
        "requestId": "request-1",
        "capturedSeconds": 12.3,
        "language": "en",
        "sideHint": None,
        "roster": [
            {"id": "p7", "jersey": "7", "name": "Alex"},
            {"id": "p13", "jersey": "13", "name": "Denis"},
        ],
        "currentLineupIds": ["p7", "p13"],
        "allowedEventTypes": ["shot", "assist"],
    }


class ContextValidationTest(unittest.TestCase):
    def test_accepts_valid_context(self):
        context = valid_context()
        self.assertIs(validate_context(context), context)

    def test_accepts_supported_audio_channel_preference(self):
        context = valid_context()
        context["audioChannelPreference"] = "left"
        self.assertEqual(
            validate_context(context)["audioChannelPreference"],
            "left",
        )

    def test_rejects_unknown_audio_channel_preference(self):
        context = valid_context()
        context["audioChannelPreference"] = "center"
        with self.assertRaisesRegex(
            RequestValidationError,
            "audioChannelPreference",
        ):
            validate_context(context)

    def test_rejects_unknown_context_fields(self):
        context = valid_context()
        context["game"] = {"events": []}
        with self.assertRaisesRegex(
            RequestValidationError, "unsupported fields: game"
        ):
            validate_context(context)

    def test_rejects_unknown_player_fields(self):
        context = valid_context()
        context["roster"][0]["privateNote"] = "do not send"
        with self.assertRaisesRegex(
            RequestValidationError, "unsupported fields: privateNote"
        ):
            validate_context(context)

    def test_rejects_duplicate_player_ids(self):
        context = valid_context()
        context["roster"][1]["id"] = "p7"
        with self.assertRaisesRegex(RequestValidationError, "IDs must be unique"):
            validate_context(context)

    def test_rejects_lineup_players_absent_from_roster(self):
        context = valid_context()
        context["currentLineupIds"].append("p99")
        with self.assertRaisesRegex(
            RequestValidationError, "absent from roster: p99"
        ):
            validate_context(context)

    def test_rejects_unsupported_event_types(self):
        context = valid_context()
        context["allowedEventTypes"].append("substitution")
        with self.assertRaisesRegex(
            RequestValidationError, "Unsupported event types: substitution"
        ):
            validate_context(context)

    def test_rejects_non_finite_timestamp(self):
        context = valid_context()
        context["capturedSeconds"] = float("nan")
        with self.assertRaisesRegex(RequestValidationError, "finite non-negative"):
            validate_context(context)


if __name__ == "__main__":
    unittest.main()
