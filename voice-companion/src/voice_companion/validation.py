from __future__ import annotations

import math

from .config import (
    ALLOWED_EVENT_TYPES,
    MAX_LINEUP_PLAYERS,
    MAX_ROSTER_PLAYERS,
    PROTOCOL_VERSION,
    SUPPORTED_LANGUAGE,
)

CONTEXT_FIELDS = {
    "protocolVersion",
    "requestId",
    "capturedSeconds",
    "language",
    "sideHint",
    "roster",
    "currentLineupIds",
    "allowedEventTypes",
}
REQUIRED_CONTEXT_FIELDS = CONTEXT_FIELDS - {"sideHint"}
PLAYER_FIELDS = {"id", "jersey", "name"}


class RequestValidationError(ValueError):
    pass


def validate_context(context):
    if not isinstance(context, dict):
        raise RequestValidationError("Context must be a JSON object.")

    unknown = sorted(set(context) - CONTEXT_FIELDS)
    if unknown:
        raise RequestValidationError(
            f"Context contains unsupported fields: {', '.join(unknown)}."
        )
    missing = sorted(REQUIRED_CONTEXT_FIELDS - set(context))
    if missing:
        raise RequestValidationError(
            f"Context is missing required fields: {', '.join(missing)}."
        )
    if context["protocolVersion"] != PROTOCOL_VERSION:
        raise RequestValidationError(
            f"Unsupported protocolVersion; expected {PROTOCOL_VERSION}."
        )

    request_id = context["requestId"]
    _require_trimmed_string(request_id, "requestId", maximum=128)

    captured_seconds = context["capturedSeconds"]
    if (
        not isinstance(captured_seconds, (int, float))
        or isinstance(captured_seconds, bool)
        or not math.isfinite(captured_seconds)
        or captured_seconds < 0
    ):
        raise RequestValidationError(
            "capturedSeconds must be a finite non-negative number."
        )

    if context["language"] != SUPPORTED_LANGUAGE:
        raise RequestValidationError(
            f"Only language '{SUPPORTED_LANGUAGE}' is supported."
        )
    if context.get("sideHint") not in {None, "team", "opponent"}:
        raise RequestValidationError(
            "sideHint must be 'team', 'opponent', or null."
        )

    roster = context["roster"]
    if not isinstance(roster, list) or len(roster) > MAX_ROSTER_PLAYERS:
        raise RequestValidationError(
            f"roster must be an array with at most {MAX_ROSTER_PLAYERS} players."
        )

    roster_ids = []
    for index, player in enumerate(roster):
        if not isinstance(player, dict):
            raise RequestValidationError(f"roster[{index}] must be an object.")
        unknown_player_fields = sorted(set(player) - PLAYER_FIELDS)
        missing_player_fields = sorted(PLAYER_FIELDS - set(player))
        if unknown_player_fields:
            raise RequestValidationError(
                f"roster[{index}] contains unsupported fields: "
                f"{', '.join(unknown_player_fields)}."
            )
        if missing_player_fields:
            raise RequestValidationError(
                f"roster[{index}] is missing fields: "
                f"{', '.join(missing_player_fields)}."
            )
        _require_trimmed_string(player["id"], f"roster[{index}].id", maximum=128)
        _require_trimmed_string(
            player["jersey"], f"roster[{index}].jersey", maximum=12
        )
        _require_trimmed_string(
            player["name"], f"roster[{index}].name", maximum=120
        )
        roster_ids.append(player["id"])

    if len(roster_ids) != len(set(roster_ids)):
        raise RequestValidationError("roster player IDs must be unique.")

    lineup = context["currentLineupIds"]
    if not isinstance(lineup, list) or len(lineup) > MAX_LINEUP_PLAYERS:
        raise RequestValidationError(
            f"currentLineupIds must contain at most {MAX_LINEUP_PLAYERS} IDs."
        )
    for index, player_id in enumerate(lineup):
        _require_trimmed_string(
            player_id, f"currentLineupIds[{index}]", maximum=128
        )
    if len(lineup) != len(set(lineup)):
        raise RequestValidationError("currentLineupIds must be unique.")
    missing_lineup_ids = sorted(set(lineup) - set(roster_ids))
    if missing_lineup_ids:
        raise RequestValidationError(
            "currentLineupIds contains players absent from roster: "
            f"{', '.join(missing_lineup_ids)}."
        )

    event_types = context["allowedEventTypes"]
    if not isinstance(event_types, list) or not event_types:
        raise RequestValidationError(
            "allowedEventTypes must be a non-empty array."
        )
    if any(not isinstance(value, str) for value in event_types):
        raise RequestValidationError(
            "allowedEventTypes values must be strings."
        )
    if len(event_types) != len(set(event_types)):
        raise RequestValidationError("allowedEventTypes must be unique.")
    unsupported_types = sorted(set(event_types) - ALLOWED_EVENT_TYPES)
    if unsupported_types:
        raise RequestValidationError(
            f"Unsupported event types: {', '.join(unsupported_types)}."
        )

    return context


def _require_trimmed_string(value, field: str, *, maximum: int):
    if (
        not isinstance(value, str)
        or not value
        or value != value.strip()
        or len(value) > maximum
        or any(ord(character) < 32 for character in value)
    ):
        raise RequestValidationError(
            f"{field} must be a trimmed non-empty string up to "
            f"{maximum} characters without control characters."
        )
