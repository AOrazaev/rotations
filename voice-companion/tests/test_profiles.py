from __future__ import annotations

import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.profiles import resolve_profile


class ProfileTest(unittest.TestCase):
    def test_balanced_profile_uses_base_model(self):
        profile = resolve_profile("balanced")
        self.assertEqual(profile.model, "base.en")
        self.assertEqual(profile.device, "auto")
        self.assertEqual(profile.compute_type, "int8")

    def test_profile_allows_explicit_overrides(self):
        profile = resolve_profile(
            "balanced",
            model="small.en",
            device="cuda",
            compute_type="float16",
        )
        self.assertEqual(profile.model, "small.en")
        self.assertEqual(profile.device, "cuda")
        self.assertEqual(profile.compute_type, "float16")

    def test_unknown_profile_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Unknown transcription profile"):
            resolve_profile("unknown")


if __name__ == "__main__":
    unittest.main()
