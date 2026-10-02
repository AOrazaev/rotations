from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.profiles import default_model_directory, resolve_profile

REQUIRED_MODEL_FILES = {"config.json", "model.bin"}


def model_is_complete(path: Path) -> bool:
    return path.is_dir() and all((path / name).is_file() for name in REQUIRED_MODEL_FILES)


def main():
    parser = argparse.ArgumentParser(
        description="Download faster-whisper models without loading them."
    )
    parser.add_argument(
        "--profile",
        action="append",
        choices=["lightweight", "balanced", "high_accuracy"],
        dest="profiles",
    )
    parser.add_argument("--model-directory")
    parser.add_argument(
        "--force",
        action="store_true",
        help="Ask faster-whisper to refresh models that are already complete.",
    )
    args = parser.parse_args()

    profiles = args.profiles or ["balanced"]
    model_directory = (
        Path(args.model_directory)
        if args.model_directory
        else default_model_directory()
    )
    model_directory.mkdir(parents=True, exist_ok=True)

    try:
        from faster_whisper.utils import download_model
    except ImportError as error:
        parser.error(
            "faster-whisper is not installed in this Python environment. "
            "Run scripts/install-transcription.ps1 first."
        )

    installed = []
    for profile_name in profiles:
        profile = resolve_profile(profile_name)
        target = model_directory / profile.model
        if model_is_complete(target) and not args.force:
            status = "already-installed"
        else:
            print(f"Downloading {profile.model} for {profile_name} to {target}...")
            download_model(profile.model, output_dir=str(target))
            if not model_is_complete(target):
                parser.error(
                    f"Download completed without required model files in {target}."
                )
            status = "downloaded"
        installed.append(
            {
                "profile": profile.name,
                "model": profile.model,
                "path": str(target),
                "status": status,
            }
        )
        print(f"{profile_name}: {profile.model} ({status})")

    manifest = {
        "formatVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "models": installed,
    }
    manifest_path = model_directory / "installed-models.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Model manifest: {manifest_path}")


if __name__ == "__main__":
    main()
