from __future__ import annotations

import os
import re
import shlex
import subprocess
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

import numpy as np

from .profiles import TranscriptionProfile, default_model_directory


BASKETBALL_HOTWORDS = (
    "basketball team opponent opponents opposing team player number point points "
    "one two three two pointer three pointer two point three point free throw free throws "
    "makes made misses missed shot rebound offensive defensive assist steal "
    "block turnover foul transition timeout substitution substitute subs in for"
)

BASKETBALL_INITIAL_PROMPT = (
    "Basketball statistics commands. Opponent makes two pointer. "
    "Opponent misses two pointer. Opponent makes three pointer. "
    "Opponent misses three pointer. Player seven makes two. "
    "Player thirteen makes three. Player thirteen makes free throw. "
    "Player seven assist. Assist by player sixty. "
    "Player seven steal. "
    "Player seven subs for player thirteen. "
    "Offensive rebound. Defensive rebound. Opponent offensive rebound. "
    "Opponent defensive rebound. Turnover. Foul."
)

JERSEY_NUMBER_WORDS = {
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
    30: "thirty",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety",
}
JERSEY_WORD_NUMBERS = {
    word: number for number, word in JERSEY_NUMBER_WORDS.items()
}
JERSEY_CONFUSIONS = {
    13: 30,
    14: 40,
    15: 50,
    16: 60,
    17: 70,
    18: 80,
    19: 90,
    30: 13,
    40: 14,
    50: 15,
    60: 16,
    70: 17,
    80: 18,
    90: 19,
}
STAT_SUBJECT_PATTERN = re.compile(
    r"\b("
    + "|".join(
        [re.escape(word) for word in JERSEY_WORD_NUMBERS]
        + [str(number) for number in JERSEY_CONFUSIONS]
    )
    + r")\b(?=\s+(?:make|makes|made|miss|misses|missed|assist|assists|"
      r"steal|steals|block|blocks|rebound|rebounds|offensive|defensive|"
      r"turnover|turnovers|foul|fouls)\b)",
    re.IGNORECASE,
)
SIX_TEAM_SUBJECT_PATTERN = re.compile(
    r"\bsix\s+team\b(?=\s+(?:make|makes|made|miss|misses|missed|assist|"
    r"assists|steal|steals|block|blocks|rebound|rebounds|offensive|"
    r"defensive|turnover|turnovers|foul|fouls)\b)",
    re.IGNORECASE,
)
THIRD_IN_SUBJECT_PATTERN = re.compile(
    r"\bthird\s+in\b(?=\s+(?:make|makes|made|miss|misses|missed|assist|"
    r"assists|steal|steals|block|blocks|rebound|rebounds|offensive|"
    r"defensive|turnover|turnovers|foul|fouls)\b)",
    re.IGNORECASE,
)


def normalize_active_jersey_confusions(
    transcript: str,
    context: dict,
) -> tuple[str, list[str]]:
    roster_by_id = {
        player["id"]: player
        for player in context.get("roster", [])
        if isinstance(player, dict)
    }
    active_jerseys = {
        str(roster_by_id[player_id]["jersey"]).strip()
        for player_id in context.get("currentLineupIds", [])
        if player_id in roster_by_id
    }
    active_numbers = {
        int(jersey)
        for jersey in active_jerseys
        if jersey.isdigit()
    }
    warnings: list[str] = []

    def replace(match: re.Match) -> str:
        token = match.group(0)
        lowered = token.lower()
        spoken_number = (
            int(token)
            if token.isdigit()
            else JERSEY_WORD_NUMBERS.get(lowered)
        )
        candidate = JERSEY_CONFUSIONS.get(spoken_number)
        if (
            candidate is None
            or spoken_number in active_numbers
            or candidate not in active_numbers
        ):
            return token
        replacement = (
            str(candidate)
            if token.isdigit()
            else JERSEY_NUMBER_WORDS[candidate]
        )
        if token[0].isupper():
            replacement = replacement.capitalize()
        warnings.append(
            f"Normalized jersey {token} to {replacement} using the active lineup."
        )
        return replacement

    normalized = STAT_SUBJECT_PATTERN.sub(replace, transcript)
    if 60 in active_numbers and not active_numbers.intersection({6, 16}):
        def replace_six_team(match: re.Match) -> str:
            replacement = (
                "Sixty"
                if match.group(0)[0].isupper()
                else "sixty"
            )
            warnings.append(
                "Normalized 'six team' to jersey sixty using the active lineup."
            )
            return replacement

        normalized = SIX_TEAM_SUBJECT_PATTERN.sub(
            replace_six_team,
            normalized,
        )
    if 13 in active_numbers and not active_numbers.intersection({3, 30}):
        def replace_third_in(match: re.Match) -> str:
            replacement = (
                "Thirteen"
                if match.group(0)[0].isupper()
                else "thirteen"
            )
            warnings.append(
                "Normalized 'third in' to jersey thirteen using the active lineup."
            )
            return replacement

        normalized = THIRD_IN_SUBJECT_PATTERN.sub(
            replace_third_in,
            normalized,
        )
    return normalized, warnings


def normalize_basketball_transcript(
    transcript: str,
    context: dict,
) -> tuple[str, list[str]]:
    normalized, warnings = normalize_active_jersey_confusions(
        transcript,
        context,
    )
    three_throw_pattern = re.compile(
        r"\bthree(?=\s+throw\b)",
        re.IGNORECASE,
    )

    def replace_three_throw(match: re.Match) -> str:
        replacement = "Free" if match.group(0)[0].isupper() else "free"
        warnings.append(
            "Normalized 'three throw' to 'free throw'."
        )
        return replacement

    normalized = three_throw_pattern.sub(
        replace_three_throw,
        normalized,
    )
    offensively_bound_pattern = re.compile(
        r"\boffensively\s+bound\b",
        re.IGNORECASE,
    )

    def replace_offensively_bound(match: re.Match) -> str:
        replacement = "Offensive rebound"
        if match.group(0)[0].islower():
            replacement = replacement.lower()
        warnings.append(
            "Normalized 'offensively bound' to 'offensive rebound'."
        )
        return replacement

    normalized = offensively_bound_pattern.sub(
        replace_offensively_bound,
        normalized,
    )
    defensively_rebound_pattern = re.compile(
        r"\bdefensively\s+(?:bound|rebound)\b",
        re.IGNORECASE,
    )

    def replace_defensively_rebound(match: re.Match) -> str:
        replacement = "Defensive rebound"
        if match.group(0)[0].islower():
            replacement = replacement.lower()
        warnings.append(
            "Normalized a defensive rebound transcription variant."
        )
        return replacement

    normalized = defensively_rebound_pattern.sub(
        replace_defensively_rebound,
        normalized,
    )
    trailing_opponent_pattern = re.compile(
        r"\b(?P<kind>offensive|defensive)\s+rebound"
        r"[.!?]\s+opponent(?P<ending>[.!?]|$)",
        re.IGNORECASE,
    )

    def replace_trailing_opponent(match: re.Match) -> str:
        warnings.append(
            "Joined a trailing opponent rebound subject."
        )
        return (
            f"{match.group('kind')} rebound by opponent"
            f"{match.group('ending')}"
        )

    normalized = trailing_opponent_pattern.sub(
        replace_trailing_opponent,
        normalized,
    )
    roster_by_id = {
        player["id"]: player
        for player in context.get("roster", [])
        if isinstance(player, dict)
    }
    active_jerseys = {
        str(roster_by_id[player_id]["jersey"]).strip().lower()
        for player_id in context.get("currentLineupIds", [])
        if player_id in roster_by_id
    }
    active_subjects = set(active_jerseys)
    for jersey in active_jerseys:
        if jersey.isdigit():
            word = JERSEY_NUMBER_WORDS.get(int(jersey))
            if word:
                active_subjects.add(word)
    if not active_subjects:
        return normalized, warnings
    subject_pattern = "|".join(
        re.escape(subject)
        for subject in sorted(active_subjects, key=len, reverse=True)
    )
    fragmented_rebound_pattern = re.compile(
        rf"\b(?P<subject>(?:(?:number|player)\s+)?(?:{subject_pattern}))"
        r"\s*[.!?]\s*"
        r"(?P<kind>offensive|defensive)\s+rebound\b",
        re.IGNORECASE,
    )

    def join_fragmented_rebound(match: re.Match) -> str:
        warnings.append(
            "Joined an active-player jersey fragment to its rebound statistic."
        )
        return (
            f"{match.group('subject')} "
            f"{match.group('kind').lower()} rebound"
        )

    normalized = fragmented_rebound_pattern.sub(
        join_fragmented_rebound,
        normalized,
    )
    assessed_pattern = re.compile(
        r"\bassessed(?=\s+by\s+(?:(?:number|player)\s+)?"
        rf"(?:{subject_pattern})\b)",
        re.IGNORECASE,
    )

    def replace_assessed(match: re.Match) -> str:
        replacement = "Assist" if match.group(0)[0].isupper() else "assist"
        warnings.append(
            "Normalized 'assessed by' to 'assist by' for an active player."
        )
        return replacement

    return assessed_pattern.sub(replace_assessed, normalized), warnings


class TranscriptionUnavailable(RuntimeError):
    pass


@dataclass(frozen=True)
class TranscriptionResult:
    text: str
    model: str
    audio_duration_seconds: float | None = None
    language_probability: float | None = None
    audio_channel_mode: str | None = None


class Transcriber(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def model_name(self) -> str | None: ...

    @property
    def state(self) -> str: ...

    def metadata(self) -> dict: ...

    def warmup(self) -> None: ...

    def transcribe(
        self,
        audio: bytes,
        suffix: str,
        *,
        channel_preference: str = "auto",
    ) -> TranscriptionResult: ...


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

    def warmup(self) -> None:
        if not self.ready:
            raise TranscriptionUnavailable(
                "External transcription is not configured."
            )

    def transcribe(
        self,
        audio: bytes,
        suffix: str,
        *,
        channel_preference: str = "auto",
    ) -> TranscriptionResult:
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
        audio_decoder: Callable | None = None,
    ):
        self.profile = profile
        self.model_directory = model_directory or default_model_directory()
        self.model_factory = model_factory
        self.audio_decoder = audio_decoder
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

    def warmup(self) -> None:
        self._load_model()

    def transcribe(
        self,
        audio: bytes,
        suffix: str,
        *,
        channel_preference: str = "auto",
    ) -> TranscriptionResult:
        model = self._load_model()
        temporary_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temporary:
                temporary.write(audio)
                temporary_path = Path(temporary.name)

            decoder = self.audio_decoder or self._import_audio_decoder()
            left, right = decoder(
                str(temporary_path),
                sampling_rate=16000,
                split_stereo=True,
            )
            audio_input, channel_mode = self._select_audio_channel(
                left,
                right,
                channel_preference,
            )
            segments, info = model.transcribe(
                audio_input,
                language="en",
                beam_size=1,
                best_of=1,
                condition_on_previous_text=False,
                vad_filter=True,
                hotwords=BASKETBALL_HOTWORDS,
                initial_prompt=BASKETBALL_INITIAL_PROMPT,
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
                audio_channel_mode=channel_mode,
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

    @staticmethod
    def _import_audio_decoder():
        from faster_whisper.audio import decode_audio

        return decode_audio

    @staticmethod
    def _select_audio_channel(left, right, preference="auto"):
        left = np.asarray(left, dtype=np.float32)
        right = np.asarray(right, dtype=np.float32)
        left_rms = float(np.sqrt(np.mean(left ** 2))) if left.size else 0.0
        right_rms = float(np.sqrt(np.mean(right ** 2))) if right.size else 0.0
        if preference == "left":
            return left, "left"
        if preference == "right":
            return right, "right"
        if preference == "mix":
            return (left + right) / 2, "mixed"
        if preference != "auto":
            raise ValueError(f"Unsupported audio channel preference: {preference}")
        dominant = max(left_rms, right_rms)
        quieter = min(left_rms, right_rms)
        if dominant >= 0.001 and quieter <= dominant * 0.1:
            return (left, "left") if left_rms > right_rms else (right, "right")
        return ((left + right) / 2, "mixed")


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
