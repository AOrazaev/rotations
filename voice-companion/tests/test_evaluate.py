from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.evaluate import normalize_transcript


class NormalizeTranscriptTest(unittest.TestCase):
    def test_normalizes_number_words_and_digits_equally(self):
        spoken = "Seven assist and thirteen makes two in transition."
        numeric = "7. Assist and 13 makes 2 in transition"

        self.assertEqual(normalize_transcript(spoken), normalize_transcript(numeric))

    def test_normalizes_compound_jersey_numbers(self):
        self.assertEqual(
            normalize_transcript("Twenty three assists forty two"),
            "23 assists 42",
        )


if __name__ == "__main__":
    unittest.main()
