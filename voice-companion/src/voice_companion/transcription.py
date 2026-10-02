from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .profiles import TranscriptionProfile, default_model_directory


class TranscriptionUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    model: str
    audio_duration_seconds: float | None = None
    language_probability: float | None = None


class Transcriber(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def model_name(self) -> str | None: ...

    @property
    def state(self) -> str: ...

    def metadata(self) -> dict: ...

    def transcribe(self, audio: bytes, suffix: str) -> TranscriptionResult: ...


class ExternalCommandTranscriber:
    def __init__(self, command_template: str | None = None):
        self.command_template = command_template or os.environ.get(
            "BASK_VOICE_TRANSCRIBE_COMMAND", ""
        )
        self.fixture_transcript = os.environ.get("BASK_VOICE_TRANSCRIPT_FIXTURE", "")

    @property
    def ready(self) -> bool:
        return bool(self.fixture_transcript) or "{audio}" in self.command_template

    @property
    def model_name(self) -> str | None:
        if self.fixture_transcript:
            return "fixture"
        return "external-command" if self.ready else None

    @property
    def state(self) -> str:
        return "ready" if self.ready else "configuration_required"

    def metadata(self) -> dict:
        return {
            "runtime": "fixture" if self.fixture_transcript else "external-command",
            "model": self.model_name,
            "device": None,
            "computeType": None,
            "modelDirectory": None,
        }

    def transcribe(self, audio: bytes, suffix: str) -> TranscriptionResult:
        if self.fixture_transcript:
            return TranscriptionResult(
                text=self.fixture_transcript,
                model="fixture",
            )
        if not self.ready:
            raise TranscriptionUnavailable(
                "Local transcription is not configured. Set "
                "BASK_VOICE_TRANSCRIBE_COMMAND to a command containing {audio}."
            )

        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
                temporary.write(audio)
                temporary_path = Path(temporary.name)

            command = self.command_template.replace(
                "{audio}", shlex.quote(str(temporary_path))
            )
            completed = subprocess.run(
                command,
                shell=True,
                check=False,
                capture_output=True,
                text=True,
                timeout=120,
            )
            if completed.returncode != 0:
                detail = completed.stderr.strip() or completed.stdout.strip()
                raise RuntimeError(
                    f"Transcription command failed with exit code "
                    f"{completed.returncode}: {detail}"
                )
            transcript = completed.stdout.strip()
            if not transcript:
                raise RuntimeError("Transcription command returned no text.")
            return TranscriptionResult(text=transcript, model="external-command")
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)


class FasterWhisperTranscriber:
    def __init__(
        self,
        profile: TranscriptionProfile,
        *,
        model_directory: Path | None = None,
        model_factory: Callable | None = None,
    ):
        self.profile = profile
        self.model_directory = model_directory or default_model_directory()
        self.model_factory = model_factory
        self._model = None
        self._state = "not_loaded"
        self._last_error: str | None = None
        self._load_lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._state == "ready"

    @property
    def model_name(self) -> str:
        return self.profile.model

    @property
    def state(self) -> str:
        return self._state

    def metadata(self) -> dict:
        return {
            "runtime": "faster-whisper",
            "model": self.profile.model,
            "device": self.profile.device,
            "computeType": self.profile.compute_type,
            "modelDirectory": str(self.model_directory),
            "lastError": self._last_error,
        }

    def transcribe(self, audio: bytes, suffix: str) -> TranscriptionResult:
        model = self._load_model()
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
                temporary.write(audio)
                temporary_path = Path(temporary.name)

            segments, info = model.transcribe(
                str(temporary_path),
                language="en",
                beam_size=1,
                best_of=1,
                condition_on_previous_text=False,
                vad_filter=True,
            )
            transcript = " ".join(
                segment.text.strip() for segment in segments if segment.text.strip()
            ).strip()
            if not transcript:
                raise RuntimeError("No speech was detected in the audio.")
            return TranscriptionResult(
                text=transcript,
                model=self.profile.model,
                audio_duration_seconds=getattr(info, "duration", None),
                language_probability=getattr(info, "language_probability", None),
            )
        finally:
            if temporary_path is not None:
                temporary_path.unlink(missing_ok=True)

    def _load_model(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            self._state = "loading"
            self._last_error = None
            try:
                factory = self.model_factory or self._import_model_factory()
                self.model_directory.mkdir(parents=True, exist_ok=True)
                downloaded_model = self.model_directory / self.profile.model
                model_source = (
                    str(downloaded_model)
                    if (downloaded_model / "model.bin").is_file()
                    else self.profile.model
                )
                self._model = factory(
                    model_source,
                    device=self.profile.device,
                    compute_type=self.profile.compute_type,
                    download_root=str(self.model_directory),
                )
                self._state = "ready"
                return self._model
            except (ImportError, ModuleNotFoundError) as error:
                self._state = "dependency_missing"
                self._last_error = str(error)
                raise TranscriptionUnavailable(
                    "faster-whisper is not installed. Install the companion "
                    "with the transcription extra."
                ) from error
            except (RuntimeError, OSError, ValueError) as error:
                self._state = "error"
                self._last_error = str(error)
                raise RuntimeError(
                    f"Could not load transcription model "
                    f"'{self.profile.model}': {error}"
                ) from error

    @staticmethod
    def _import_model_factory():
        from faster_whisper import WhisperModel

        return WhisperModel


def create_transcriber(
    runtime: str,
    *,
    profile: TranscriptionProfile | None = None,
    model_directory: Path | None = None,
) -> Transcriber:
    fixture = os.environ.get("BASK_VOICE_TRANSCRIPT_FIXTURE")
    if fixture:
        return ExternalCommandTranscriber()
    if runtime == "faster-whisper":
        if profile is None:
            raise ValueError("A transcription profile is required for faster-whisper.")
        return FasterWhisperTranscriber(
            profile,
            model_directory=model_directory,
        )
    if runtime == "external-command":
        return ExternalCommandTranscriber()
    raise ValueError(
        f"Unknown transcription runtime '{runtime}'. "
        "Choose 'faster-whisper' or 'external-command'."
    )
