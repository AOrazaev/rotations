from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.hardware import _recommended_profile, detect_hardware


class HardwareDetectionTest(unittest.TestCase):
    def test_detects_bounded_non_identifying_hardware_metadata(self):
        hardware = detect_hardware()

        self.assertGreaterEqual(hardware["logicalProcessors"], 1)
        self.assertIn(
            hardware["recommendedProfile"],
            {"lightweight", "balanced", "high_accuracy"},
        )
        self.assertNotIn("hostname", hardware)
        self.assertNotIn("username", hardware)

    def test_recommends_profiles_from_resources(self):
        self.assertEqual(
            _recommended_profile(4, 8 * 1024**3, 0),
            "lightweight",
        )
        self.assertEqual(
            _recommended_profile(8, 16 * 1024**3, 0),
            "balanced",
        )
        self.assertEqual(
            _recommended_profile(8, 16 * 1024**3, 1),
            "high_accuracy",
        )


if __name__ == "__main__":
    unittest.main()
