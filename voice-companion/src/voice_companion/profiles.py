from __future__ import annotations

import os
from dataclasses import dataclass, replace
from pathlib import Path


@dataclass(frozen=True)
class TranscriptionProfile:
    name: str
    model: str
    device: str
    compute_type: str


PROFILES = {
    "lightweight": TranscriptionProfile(
        name="lightweight",
        model="tiny.en",
        device="cpu",
        compute_type="int8",
    ),
    "balanced": TranscriptionProfile(
        name="balanced",
        model="base.en",
        device="auto",
        compute_type="int8",
    ),
    "high_accuracy": TranscriptionProfile(
        name="high_accuracy",
        model="small.en",
        device="cuda",
        compute_type="float16",
    ),
}


def resolve_profile(
    name: str,
    *,
    model: str | None = None,
    device: str | None = None,
    compute_type: str | None = None,
) -> TranscriptionProfile:
    try:
        profile = PROFILES[name]
    except KeyError as error:
        raise ValueError(
            f"Unknown transcription profile '{name}'. "
            f"Choose one of: {', '.join(sorted(PROFILES))}."
        ) from error
    return replace(
        profile,
        model=model or profile.model,
        device=device or profile.device,
        compute_type=compute_type or profile.compute_type,
    )


def default_model_directory() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if local_app_data:
        return Path(local_app_data) / "BaskVoiceCompanion" / "models"
    return Path.home() / ".cache" / "bask-voice-companion" / "models"
