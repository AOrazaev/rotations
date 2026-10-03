from __future__ import annotations

from dataclasses import dataclass, field

PROTOCOL_VERSION = 1
SUPPORTED_LANGUAGE = "en"
MAX_AUDIO_BYTES = 8 * 1024 * 1024
MAX_CONTEXT_BYTES = 64 * 1024
MAX_DURATION_SECONDS = 20
MAX_ROSTER_PLAYERS = 30
MAX_LINEUP_PLAYERS = 5
MAX_CONCURRENT_REQUESTS = 1
MAX_PROCESSING_SECONDS = 120

DEFAULT_ALLOWED_ORIGINS = {
    "https://aorazaev.github.io",
    "http://127.0.0.1:4173",
    "http://localhost:4173",
}

ALLOWED_AUDIO_TYPES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
}

ALLOWED_EVENT_TYPES = {
    "shot",
    "rebound",
    "assist",
    "steal",
    "block",
    "turnover",
    "foul",
    "timeout",
}


@dataclass(frozen=True)
class ServiceSettings:
    token: str
    authentication_required: bool = True
    allowed_origins: frozenset[str] = field(
        default_factory=lambda: frozenset(DEFAULT_ALLOWED_ORIGINS)
    )
    max_audio_bytes: int = MAX_AUDIO_BYTES
    max_context_bytes: int = MAX_CONTEXT_BYTES
    max_duration_seconds: int = MAX_DURATION_SECONDS
    max_concurrent_requests: int = MAX_CONCURRENT_REQUESTS
    max_processing_seconds: int = MAX_PROCESSING_SECONDS
    profile: str = "spike"

    def __post_init__(self):
        if self.authentication_required and not self.token:
            raise ValueError("A non-empty pairing token is required.")
        if self.max_audio_bytes <= 0:
            raise ValueError("max_audio_bytes must be positive.")
        if self.max_context_bytes <= 0:
            raise ValueError("max_context_bytes must be positive.")
        if self.max_duration_seconds <= 0:
            raise ValueError("max_duration_seconds must be positive.")
        if self.max_concurrent_requests <= 0:
            raise ValueError("max_concurrent_requests must be positive.")
        if self.max_processing_seconds <= 0:
            raise ValueError("max_processing_seconds must be positive.")
