from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.validate_checkpoint4 import summarize_rounds


class CheckpointFourValidationTest(unittest.TestCase):
    def test_summarizes_repeated_corpus_results(self):
        case = {
            "eventArrayExact": True,
            "warningExpectationMet": True,
            "latencyMs": 100,
            "error": None,
        }
        report = summarize_rounds(
            [
                {"caseResults": [case, {**case, "latencyMs": 200}]},
                {"caseResults": [{**case, "latencyMs": 300}]},
            ]
        )

        self.assertEqual(report["commandCount"], 3)
        self.assertEqual(report["exactEventArrays"], 3)
        self.assertEqual(report["medianLatencyMs"], 200)
        self.assertEqual(report["p95LatencyMs"], 300)
        self.assertEqual(report["maxLatencyMs"], 300)
        self.assertTrue(report["passed"])


if __name__ == "__main__":
    unittest.main()
