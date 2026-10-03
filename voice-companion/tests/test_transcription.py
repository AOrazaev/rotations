from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.profiles import resolve_profile
from voice_companion.transcription import (
    BASKETBALL_HOTWORDS,
    BASKETBALL_INITIAL_PROMPT,
    FasterWhisperTranscriber,
)


class FakeSegment:
    def __init__(self, text):
        self.text = text


class FakeModel:
    def __init__(self):
        self.audio = None
        self.options = None

    def transcribe(self, audio, **options):
        self.audio = audio
        self.options = options
        return (
            iter([FakeSegment(" Seven assist"), FakeSegment(" thirteen makes two ")]),
            SimpleNamespace(duration=2.4, language_probability=0.99),
        )


class FasterWhisperTranscriberTest(unittest.TestCase):
    def test_loads_model_once_and_deletes_temporary_audio(self):
        calls = []
        model = FakeModel()

        def factory(*args, **kwargs):
            calls.append((args, kwargs))
            return model

        decoded_paths = []

        def decoder(audio_path, **options):
            decoded_paths.append(Path(audio_path))
            return (
                np.array([0.2, -0.2], dtype=np.float32),
                np.array([0.001, -0.001], dtype=np.float32),
            )

        with tempfile.TemporaryDirectory() as directory:
            transcriber = FasterWhisperTranscriber(
                resolve_profile("lightweight"),
                model_directory=Path(directory) / "models",
                model_factory=factory,
                audio_decoder=decoder,
            )
            self.assertEqual(transcriber.state, "not_loaded")

            first = transcriber.transcribe(b"first-audio", ".webm")
            second = transcriber.transcribe(b"second-audio", ".webm")

            self.assertEqual(len(calls), 1)
            self.assertEqual(transcriber.state, "ready")
            self.assertEqual(first.text, "Seven assist thirteen makes two")
            self.assertEqual(second.model, "tiny.en")
            self.assertEqual(first.audio_duration_seconds, 2.4)
            self.assertEqual(first.language_probability, 0.99)
            self.assertEqual(first.audio_channel_mode, "left")
            self.assertTrue(np.array_equal(
                model.audio,
                np.array([0.2, -0.2], dtype=np.float32),
            ))
            self.assertTrue(all(not path.exists() for path in decoded_paths))
            self.assertEqual(model.options["language"], "en")
            self.assertTrue(model.options["vad_filter"])
            self.assertEqual(model.options["hotwords"], BASKETBALL_HOTWORDS)
            self.assertEqual(
                model.options["initial_prompt"],
                BASKETBALL_INITIAL_PROMPT,
            )
            self.assertIn("three pointer", model.options["hotwords"])
            self.assertIn("opponent", model.options["hotwords"])
            self.assertIn(
                "Opponent misses two pointer",
                model.options["initial_prompt"],
            )

    def test_selects_right_channel_or_mixes_balanced_stereo(self):
        selected, mode = FasterWhisperTranscriber._select_audio_channel(
            np.array([0.001, -0.001]),
            np.array([0.2, -0.2]),
        )
        self.assertEqual(mode, "right")
        self.assertTrue(np.allclose(selected, np.array([0.2, -0.2])))

        selected, mode = FasterWhisperTranscriber._select_audio_channel(
            np.array([0.2, -0.2]),
            np.array([0.1, -0.1]),
        )
        self.assertEqual(mode, "mixed")
        self.assertTrue(np.allclose(selected, np.array([0.15, -0.15])))

    def test_reports_model_load_failure(self):
        def factory(*args, **kwargs):
            raise RuntimeError("unsupported compute type")

        with tempfile.TemporaryDirectory() as directory:
            transcriber = FasterWhisperTranscriber(
                resolve_profile("balanced"),
                model_directory=Path(directory),
                model_factory=factory,
            )
            with self.assertRaisesRegex(
                RuntimeError, "Could not load transcription model"
            ):
                transcriber.transcribe(b"audio", ".webm")
            self.assertEqual(transcriber.state, "error")
            self.assertIn("unsupported compute type", transcriber.metadata()["lastError"])


if __name__ == "__main__":
    unittest.main()
