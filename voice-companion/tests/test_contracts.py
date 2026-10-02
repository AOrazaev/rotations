from __future__ import annotations

import json
import unittest
from pathlib import Path

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class ContractFixtureTest(unittest.TestCase):
    def load(self, relative_path: str):
        return json.loads((REPOSITORY_ROOT / relative_path).read_text(encoding="utf-8"))

    def test_request_fixture_matches_checkpoint_contract(self):
        schema = self.load("contracts/voice-command-request-v1.schema.json")
        fixture = self.load("contracts/fixtures/voice-command-request-v1.json")

        self.assertEqual(fixture["protocolVersion"], 1)
        self.assertEqual(set(schema["required"]) - set(fixture), set())
        self.assertLessEqual(
            len(fixture["roster"]),
            schema["properties"]["roster"]["maxItems"],
        )
        self.assertEqual(len(fixture["currentLineupIds"]), len(set(fixture["currentLineupIds"])))

    def test_response_fixture_matches_checkpoint_contract(self):
        schema = self.load("contracts/voice-command-response-v1.schema.json")
        fixture = self.load("contracts/fixtures/voice-command-response-v1.json")

        self.assertEqual(fixture["protocolVersion"], 1)
        self.assertEqual(set(schema["required"]) - set(fixture), set())
        self.assertEqual(fixture["events"], [])
        self.assertIsNone(fixture["processor"]["commandModel"])

    def test_interpret_request_fixture_matches_checkpoint_contract(self):
        schema = self.load("contracts/interpret-command-request-v1.schema.json")
        fixture = self.load("contracts/fixtures/interpret-command-request-v1.json")

        self.assertEqual(set(schema["required"]) - set(fixture), set())
        self.assertLessEqual(
            len(fixture["transcript"]),
            schema["properties"]["transcript"]["maxLength"],
        )
        self.assertEqual(fixture["context"]["protocolVersion"], 1)


if __name__ == "__main__":
    unittest.main()
