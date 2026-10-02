from __future__ import annotations

import argparse
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.interpretation import DEFAULT_COMMAND_MODEL
from voice_companion.profiles import default_model_directory

MODEL_REPOSITORY = "Qwen/Qwen3-4B-GGUF"


def main():
    parser = argparse.ArgumentParser(
        description="Download the local command interpretation model."
    )
    parser.add_argument("--model-directory")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()

    model_directory = (
        Path(args.model_directory)
        if args.model_directory
        else default_model_directory()
    )
    model_directory.mkdir(parents=True, exist_ok=True)
    target = model_directory / DEFAULT_COMMAND_MODEL

    try:
        from huggingface_hub import hf_hub_download
    except ImportError:
        parser.error(
            "huggingface-hub is not installed. Run "
            "scripts/install-interpretation.ps1 first."
        )

    if target.is_file() and target.stat().st_size > 0 and not args.force:
        status = "already-installed"
    else:
        print(
            f"Downloading {DEFAULT_COMMAND_MODEL} from {MODEL_REPOSITORY} "
            f"to {model_directory}..."
        )
        downloaded = Path(
            hf_hub_download(
                repo_id=MODEL_REPOSITORY,
                filename=DEFAULT_COMMAND_MODEL,
                local_dir=model_directory,
                force_download=args.force,
            )
        )
        if downloaded.resolve() != target.resolve():
            shutil.copyfile(downloaded, target)
        if not target.is_file() or target.stat().st_size == 0:
            parser.error(f"Command model download is incomplete: {target}")
        status = "downloaded"

    manifest = {
        "formatVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "repository": MODEL_REPOSITORY,
        "model": DEFAULT_COMMAND_MODEL,
        "path": str(target),
        "sizeBytes": target.stat().st_size,
        "status": status,
    }
    manifest_path = model_directory / "installed-command-model.json"
    manifest_path.write_text(
        json.dumps(manifest, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Command model: {target} ({status})")
    print(f"Command model manifest: {manifest_path}")


if __name__ == "__main__":
    main()
