from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.cancellation import (
    CancellationSignal,
    ProcessingCancelled,
)


class CancellationSignalTest(unittest.TestCase):
    def test_preserves_first_cancellation_reason(self):
        signal = CancellationSignal()

        self.assertTrue(signal.cancel("timeout"))
        self.assertFalse(signal.cancel("cancelled"))
        with self.assertRaises(ProcessingCancelled) as raised:
            signal.raise_if_cancelled()

        self.assertEqual(raised.exception.reason, "timeout")
        self.assertEqual(str(raised.exception), "Processing timed out.")


if __name__ == "__main__":
    unittest.main()
