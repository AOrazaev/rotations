from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))
os.environ["BASK_VOICE_TRANSCRIPT_FIXTURE"] = (
    "Seven assist and thirteen makes two in transition"
)

from voice_companion.server import main

main()
