from __future__ import annotations

import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))
os.environ["BASK_VOICE_TRANSCRIPT_FIXTURE"] = (
    "Seven assist and thirteen makes two in transition"
)
os.environ["BASK_VOICE_INTERPRETATION_FIXTURE"] = """
{
  "events": [
    {
      "side": "team",
      "type": "shot",
      "playerId": "p13",
      "shotValue": 2,
      "made": true,
      "shotDetails": {"phase": "transition"},
      "confidence": 0.98
    },
    {
      "side": "team",
      "type": "assist",
      "playerId": "p7",
      "confidence": 0.96
    }
  ],
  "overallConfidence": 0.96,
  "warnings": []
}
"""

from voice_companion.server import main

main()
