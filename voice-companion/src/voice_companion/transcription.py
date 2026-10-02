from __future__ import annotations

import os
import shlex
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


class TranscriptionUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    model: str


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
