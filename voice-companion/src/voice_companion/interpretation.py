from __future__ import annotations

import json
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .cancellation import CancellationSignal, ProcessingCancelled
from .config import ALLOWED_EVENT_TYPES
from .profiles import default_model_directory


MAX_PROPOSED_EVENTS = 20
MAX_WARNINGS = 20
DEFAULT_COMMAND_MODEL = "Qwen3-4B-Q4_K_M.gguf"
NUMBER_WORDS = {
    0: "zero",
    1: "one",
    2: "two",
    3: "three",
    4: "four",
    5: "five",
    6: "six",
    7: "seven",
    8: "eight",
    9: "nine",
    10: "ten",
    11: "eleven",
    12: "twelve",
    13: "thirteen",
    14: "fourteen",
    15: "fifteen",
    16: "sixteen",
    17: "seventeen",
    18: "eighteen",
    19: "nineteen",
}
TENS_WORDS = {
    20: "twenty",
    30: "thirty",
    40: "forty",
    50: "fifty",
    60: "sixty",
    70: "seventy",
    80: "eighty",
    90: "ninety",
}
COMMAND_OUTPUT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["events", "overallConfidence", "warnings"],
    "properties": {
        "events": {
            "type": "array",
            "maxItems": MAX_PROPOSED_EVENTS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["side", "type", "playerId", "confidence"],
                "properties": {
                    "side": {"type": "string", "enum": ["team", "opponent"]},
                    "type": {
                        "type": "string",
                        "enum": sorted(ALLOWED_EVENT_TYPES),
                    },
                    "playerId": {"type": ["string", "null"]},
                    "playerInId": {"type": "string"},
                    "playerOutId": {"type": "string"},
                    "shotValue": {"type": "integer", "enum": [1, 2, 3]},
                    "made": {"type": "boolean"},
                    "reboundKind": {
                        "type": "string",
                        "enum": ["offensive", "defensive"],
                    },
                    "shotDetails": {
                        "type": "object",
                        "additionalProperties": False,
                        "properties": {
                            "phase": {
                                "type": "string",
                                "enum": ["half_court", "transition"],
                            }
                        },
                    },
                    "confidence": {
                        "type": "number",
                        "minimum": 0,
                        "maximum": 1,
                    },
                },
            },
        },
        "overallConfidence": {
            "type": ["number", "null"],
            "minimum": 0,
            "maximum": 1,
        },
        "warnings": {
            "type": "array",
            "maxItems": MAX_WARNINGS,
            "items": {"type": "string"},
        },
    },
}


class InterpretationUnavailable(RuntimeError):
    pass


class InvalidInterpretation(RuntimeError):
    pass


@dataclass(frozen=True)
class InterpretationResult:
    events: list[dict]
    overall_confidence: float | None
    warnings: list[str]
    model: str | None


class CommandInterpreter(Protocol):
    @property
    def ready(self) -> bool: ...

    @property
    def model_name(self) -> str | None: ...

    @property
    def state(self) -> str: ...

    def metadata(self) -> dict: ...

    def warmup(self) -> None: ...

    def interpret(
        self,
        transcript: str,
        context: dict,
        cancellation: CancellationSignal | None = None,
    ) -> InterpretationResult: ...


class DisabledCommandInterpreter:
    ready = False
    model_name = None
    state = "configuration_required"

    def metadata(self) -> dict:
        return {
            "runtime": "disabled",
            "model": None,
            "modelPath": None,
            "lastError": None,
        }

    def warmup(self) -> None:
        return None

    def interpret(
        self,
        transcript: str,
        context: dict,
        cancellation: CancellationSignal | None = None,
    ) -> InterpretationResult:
        raise InterpretationUnavailable(
            "Local command interpretation is not configured."
        )


class LlamaCppCommandInterpreter:
    def __init__(
        self,
        *,
        model_path: Path | None = None,
        model_factory: Callable | None = None,
        context_size: int = 4096,
        gpu_layers: int = 0,
    ):
        self.model_path = model_path or (
            default_model_directory() / DEFAULT_COMMAND_MODEL
        )
        self.model_factory = model_factory
        self.context_size = context_size
        self.gpu_layers = gpu_layers
        self._model = None
        self._state = "not_loaded"
        self._last_error: str | None = None
        self._load_lock = threading.Lock()

    @property
    def ready(self) -> bool:
        return self._state == "ready"

    @property
    def model_name(self) -> str:
        return self.model_path.name

    @property
    def state(self) -> str:
        return self._state

    def metadata(self) -> dict:
        return {
            "runtime": "llama-cpp-python",
            "model": self.model_name,
            "modelPath": str(self.model_path),
            "contextSize": self.context_size,
            "gpuLayers": self.gpu_layers,
            "lastError": self._last_error,
        }

    def warmup(self) -> None:
        self._load_model()

    def interpret(
        self,
        transcript: str,
        context: dict,
        cancellation: CancellationSignal | None = None,
    ) -> InterpretationResult:
        if not isinstance(transcript, str) or not transcript.strip():
            raise InvalidInterpretation("Transcript must be a non-empty string.")
        if cancellation:
            cancellation.raise_if_cancelled()
        substitution = _interpret_explicit_substitution(
            transcript.strip(),
            context,
            self.model_name,
        )
        if substitution:
            if "substitution" not in context["allowedEventTypes"]:
                raise InvalidInterpretation(
                    "Substitution events are not allowed by this request."
                )
            return substitution
        if _mentions_substitution(transcript):
            raise InvalidInterpretation(
                "Use a substitution-only phrase such as 'number 7 subs for 13'."
            )
        model = self._load_model()
        options = dict(
            messages=[
                {"role": "system", "content": self._system_prompt()},
                {
                    "role": "user",
                    "content": self._user_prompt(transcript.strip(), context),
                },
            ],
            temperature=0,
            top_p=1,
            seed=0,
            max_tokens=1024,
            response_format={
                "type": "json_object",
                "schema": COMMAND_OUTPUT_SCHEMA,
            },
        )
        if cancellation is None:
            response = model.create_chat_completion(**options)
            content = self._response_content(response)
        else:
            chunks = model.create_chat_completion(stream=True, **options)
            content_parts = []
            try:
                for chunk in chunks:
                    cancellation.raise_if_cancelled()
                    delta = chunk["choices"][0].get("delta", {})
                    if delta.get("content"):
                        content_parts.append(delta["content"])
            finally:
                close = getattr(chunks, "close", None)
                if callable(close):
                    close()
            content = "".join(content_parts)
        try:
            payload = json.loads(content)
        except (TypeError, json.JSONDecodeError) as error:
            raise InvalidInterpretation(
                "Command model returned an invalid structured response."
            ) from error
        payload = _ground_model_payload(transcript, payload, context)
        result = validate_interpretation(payload, context, self.model_name)
        result = _ground_explicit_transcript_facts(transcript, result, context)
        _validate_spoken_event_coverage(transcript, result)
        return result

    @staticmethod
    def _response_content(response) -> str:
        try:
            return response["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise InvalidInterpretation(
                "Command model returned an invalid structured response."
            ) from error

    def _load_model(self):
        if self._model is not None:
            return self._model
        with self._load_lock:
            if self._model is not None:
                return self._model
            self._state = "loading"
            self._last_error = None
            try:
                if self.model_factory is None and not self.model_path.is_file():
                    raise FileNotFoundError(
                        f"Command model file does not exist: {self.model_path}"
                    )
                factory = self.model_factory or self._import_model_factory()
                self._model = factory(
                    model_path=str(self.model_path),
                    n_ctx=self.context_size,
                    n_gpu_layers=self.gpu_layers,
                    seed=0,
                    verbose=False,
                )
                self._state = "ready"
                return self._model
            except (ImportError, ModuleNotFoundError) as error:
                self._state = "dependency_missing"
                self._last_error = str(error)
                raise InterpretationUnavailable(
                    "llama-cpp-python is not installed. Install the command-model "
                    "runtime before enabling interpretation."
                ) from error
            except (FileNotFoundError, RuntimeError, OSError, ValueError) as error:
                self._state = "error"
                self._last_error = str(error)
                raise InterpretationUnavailable(
                    f"Could not load command model '{self.model_name}': {error}"
                ) from error

    @staticmethod
    def _import_model_factory():
        from llama_cpp import Llama

        return Llama

    @staticmethod
    def _system_prompt() -> str:
        return (
            "/no_think\n"
            "You convert one spoken basketball statistics command into strict "
            "JSON. Output no prose. Never invent a player ID or an unspoken "
            "fact. Use only supplied roster IDs and allowed event types. If a "
            "player or action is ambiguous, return no event for that fact and "
            "add a concise warning. Represent every distinct explicitly spoken "
            "supported statistic as a separate event. Never omit an explicitly "
            "spoken assist, rebound, steal, block, turnover, foul, make, or miss. "
            "Emit exactly one event per explicitly spoken statistic and never "
            "duplicate an event. "
            "A made or missed free throw is a shot with "
            "shotValue 1. A made basket is a shot with made true. A missed "
            "basket is a shot with made false. Put a scoring shot before its "
            "related assist so equivalent phrasings produce the same order. "
            "For 'A assist and B makes two', emit B's shot and A's assist. "
            "A timeout is team-level: use playerId null and side 'team' or "
            "'opponent' exactly as spoken. "
            "A substitution is a team event with playerId null, playerInId for "
            "the entering bench player, and playerOutId for the outgoing "
            "on-court player. Never combine a substitution with another event. "
            "Opponent statistics are team-level: always use side 'opponent' and "
            "playerId null. Never assign a team roster player to an opponent "
            "event. Team statistics require a resolved supplied roster ID. "
            "Resolve each clause independently when the side changes. After an "
            "opponent event, an explicit roster jersey number starts a team "
            "event unless that clause also says opponent."
        )

    @staticmethod
    def _user_prompt(transcript: str, context: dict) -> str:
        grounded_context = {
            "sideHint": context.get("sideHint"),
            "roster": context["roster"],
            "currentLineupIds": context["currentLineupIds"],
            "allowedEventTypes": context["allowedEventTypes"],
        }
        examples = []
        roster = context["roster"]
        if len(roster) >= 2:
            assister, scorer = roster[0], roster[1]
            examples.append(
                {
                    "transcript": (
                        f"{assister['jersey']} assist and {scorer['jersey']} "
                        "makes two in transition"
                    ),
                    "result": {
                        "events": [
                            {
                                "side": "team",
                                "type": "shot",
                                "playerId": scorer["id"],
                                "shotValue": 2,
                                "made": True,
                                "shotDetails": {"phase": "transition"},
                                "confidence": 0.98,
                            },
                            {
                                "side": "team",
                                "type": "assist",
                                "playerId": assister["id"],
                                "confidence": 0.96,
                            },
                        ],
                        "overallConfidence": 0.96,
                        "warnings": [],
                    },
                }
            )
        if roster:
            rebounder = roster[0]
            examples.append(
                {
                    "transcript": (
                        "Opponent misses two pointer. Number "
                        f"{rebounder['jersey']} defensive rebound."
                    ),
                    "result": {
                        "events": [
                            {
                                "side": "opponent",
                                "type": "shot",
                                "playerId": None,
                                "shotValue": 2,
                                "made": False,
                                "confidence": 0.99,
                            },
                            {
                                "side": "team",
                                "type": "rebound",
                                "playerId": rebounder["id"],
                                "reboundKind": "defensive",
                                "confidence": 0.99,
                            },
                        ],
                        "overallConfidence": 0.99,
                        "warnings": [],
                    },
                }
            )
        active_ids = set(context["currentLineupIds"])
        outgoing = next(
            (player for player in roster if player["id"] in active_ids),
            None,
        )
        incoming = next(
            (player for player in roster if player["id"] not in active_ids),
            None,
        )
        if outgoing and incoming:
            examples.append(
                {
                    "transcript": (
                        f"Number {incoming['jersey']} subs for "
                        f"{outgoing['jersey']}"
                    ),
                    "result": {
                        "events": [
                            {
                                "side": "team",
                                "type": "substitution",
                                "playerId": None,
                                "playerInId": incoming["id"],
                                "playerOutId": outgoing["id"],
                                "confidence": 0.99,
                            }
                        ],
                        "overallConfidence": 0.99,
                        "warnings": [],
                    },
                }
            )
        examples.append(
            {
                "transcript": "Opponent defensive rebound",
                "result": {
                    "events": [
                        {
                            "side": "opponent",
                            "type": "rebound",
                            "playerId": None,
                            "reboundKind": "defensive",
                            "confidence": 0.99,
                        }
                    ],
                    "overallConfidence": 0.99,
                    "warnings": [],
                },
            }
        )
        examples.append(
            {
                "transcript": "Opponent timeout",
                "result": {
                    "events": [
                        {
                            "side": "opponent",
                            "type": "timeout",
                            "playerId": None,
                            "confidence": 0.99,
                        }
                    ],
                    "overallConfidence": 0.99,
                    "warnings": [],
                },
            }
        )
        examples.append(
            {
                "transcript": "Opponent foul",
                "result": {
                    "events": [
                        {
                            "side": "opponent",
                            "type": "foul",
                            "playerId": None,
                            "confidence": 0.99,
                        }
                    ],
                    "overallConfidence": 0.99,
                    "warnings": [],
                },
            }
        )
        examples.append(
            {
                "transcript": "Opponent misses free throw",
                "result": {
                    "events": [
                        {
                            "side": "opponent",
                            "type": "shot",
                            "playerId": None,
                            "shotValue": 1,
                            "made": False,
                            "confidence": 0.99,
                        }
                    ],
                    "overallConfidence": 0.99,
                    "warnings": [],
                },
            }
        )
        examples.append(
            {
                "transcript": "He made it",
                "result": {
                    "events": [],
                    "overallConfidence": None,
                    "warnings": ["Player and shot value are ambiguous."],
                },
            }
        )
        return json.dumps(
            {
                "context": grounded_context,
                "examples": examples,
                "transcript": transcript,
            },
            separators=(",", ":"),
        )


def validate_interpretation(
    payload: object, context: dict, model_name: str
) -> InterpretationResult:
    if not isinstance(payload, dict):
        raise InvalidInterpretation("Interpretation must be a JSON object.")
    allowed_top_level = {"events", "overallConfidence", "warnings"}
    unexpected = sorted(set(payload) - allowed_top_level)
    missing = sorted(allowed_top_level - set(payload))
    if unexpected or missing:
        raise InvalidInterpretation(
            _field_error("interpretation", unexpected, missing)
        )

    events = payload["events"]
    warnings = payload["warnings"]
    confidence = payload["overallConfidence"]
    if not isinstance(events, list) or len(events) > MAX_PROPOSED_EVENTS:
        raise InvalidInterpretation("events must be a bounded array.")
    if (
        not isinstance(warnings, list)
        or len(warnings) > MAX_WARNINGS
        or any(not isinstance(warning, str) or not warning.strip() for warning in warnings)
    ):
        raise InvalidInterpretation("warnings must contain non-empty strings.")
    if confidence is not None and not _is_confidence(confidence):
        raise InvalidInterpretation(
            "overallConfidence must be null or a number from 0 through 1."
        )

    roster_ids = {player["id"] for player in context["roster"]}
    allowed_types = set(context["allowedEventTypes"])
    validated_events = [
        _validate_event(event, roster_ids, allowed_types, index)
        for index, event in enumerate(events)
    ]
    validated_events, normalization_warnings = _normalize_events(validated_events)
    return InterpretationResult(
        events=validated_events,
        overall_confidence=confidence,
        warnings=[
            *(warning.strip() for warning in warnings),
            *normalization_warnings,
        ],
        model=model_name,
    )


def _validate_event(
    event: object,
    roster_ids: set[str],
    allowed_types: set[str],
    index: int,
) -> dict:
    if not isinstance(event, dict):
        raise InvalidInterpretation(f"events[{index}] must be an object.")
    common = {"side", "type", "playerId", "confidence"}
    optional = {
        "shotValue",
        "made",
        "reboundKind",
        "shotDetails",
        "playerInId",
        "playerOutId",
    }
    unexpected = sorted(set(event) - common - optional)
    missing = sorted(common - set(event))
    if unexpected or missing:
        raise InvalidInterpretation(
            _field_error(f"events[{index}]", unexpected, missing)
        )

    event_type = event["type"]
    if event["side"] not in {"team", "opponent"}:
        raise InvalidInterpretation(f"events[{index}].side is unsupported.")
    if event_type not in ALLOWED_EVENT_TYPES or event_type not in allowed_types:
        raise InvalidInterpretation(f"events[{index}].type is unsupported.")
    player_id = event["playerId"]
    if player_id is not None and player_id not in roster_ids:
        raise InvalidInterpretation(
            f"events[{index}].playerId is absent from the supplied roster."
        )
    if event["side"] == "opponent" and player_id is not None:
        raise InvalidInterpretation(
            f"events[{index}] opponent statistics must use playerId null."
        )
    if (
        event["side"] == "team"
        and player_id is None
        and event_type not in {"timeout", "substitution"}
    ):
        raise InvalidInterpretation(
            f"events[{index}] team statistics require a supplied roster player."
        )
    if event_type in {"timeout", "substitution"} and player_id is not None:
        raise InvalidInterpretation(
            f"events[{index}] {event_type} must use playerId null."
        )
    if not _is_confidence(event["confidence"]):
        raise InvalidInterpretation(
            f"events[{index}].confidence must be from 0 through 1."
        )

    if event_type == "shot":
        if event.get("shotValue") not in {1, 2, 3}:
            raise InvalidInterpretation(
                f"events[{index}].shotValue is required for shots."
            )
        if not isinstance(event.get("made"), bool):
            raise InvalidInterpretation(
                f"events[{index}].made is required for shots."
            )
        if "reboundKind" in event:
            raise InvalidInterpretation(
                f"events[{index}].reboundKind is invalid for shots."
            )
        _reject_fields(event, index, {"playerInId", "playerOutId"})
        shot_details = event.get("shotDetails")
        if shot_details is not None:
            if event["shotValue"] == 1:
                raise InvalidInterpretation(
                    f"events[{index}].shotDetails is invalid for free throws."
                )
            _validate_shot_details(shot_details, index)
            if not shot_details:
                del event["shotDetails"]
    elif event_type == "rebound":
        if event.get("reboundKind") not in {"offensive", "defensive"}:
            raise InvalidInterpretation(
                f"events[{index}].reboundKind is required for rebounds."
            )
        _reject_fields(
            event,
            index,
            {"shotValue", "made", "shotDetails", "playerInId", "playerOutId"},
        )
    elif event_type == "substitution":
        if event["side"] != "team":
            raise InvalidInterpretation(
                f"events[{index}] substitution must use side team."
            )
        player_in_id = event.get("playerInId")
        player_out_id = event.get("playerOutId")
        if (
            player_in_id not in roster_ids
            or player_out_id not in roster_ids
            or player_in_id == player_out_id
        ):
            raise InvalidInterpretation(
                f"events[{index}] substitution players are invalid."
            )
        _reject_fields(
            event,
            index,
            {"shotValue", "made", "reboundKind", "shotDetails"},
        )
    else:
        _reject_fields(
            event,
            index,
            {
                "shotValue",
                "made",
                "reboundKind",
                "shotDetails",
                "playerInId",
                "playerOutId",
            },
        )
    return event


def _validate_shot_details(value: object, index: int):
    if not isinstance(value, dict):
        raise InvalidInterpretation(f"events[{index}].shotDetails must be an object.")
    unexpected = sorted(set(value) - {"phase"})
    if unexpected:
        raise InvalidInterpretation(
            f"events[{index}].shotDetails contains unsupported fields: "
            f"{', '.join(unexpected)}."
        )
    if "phase" in value and value["phase"] not in {"half_court", "transition"}:
        raise InvalidInterpretation(
            f"events[{index}].shotDetails.phase is unsupported."
        )


def _reject_fields(event: dict, index: int, fields: set[str]):
    invalid = sorted(fields & set(event))
    if invalid:
        raise InvalidInterpretation(
            f"events[{index}] contains fields invalid for its type: "
            f"{', '.join(invalid)}."
        )


def _normalize_events(events: list[dict]) -> tuple[list[dict], list[str]]:
    unique = []
    seen = set()
    removed_duplicates = 0
    for event in events:
        identity = json.dumps(
            {key: value for key, value in event.items() if key != "confidence"},
            sort_keys=True,
            separators=(",", ":"),
        )
        if identity in seen:
            removed_duplicates += 1
            continue
        seen.add(identity)
        unique.append(event)

    event_types = {event["type"] for event in unique}
    if event_types == {"shot", "assist"}:
        unique.sort(key=lambda event: 0 if event["type"] == "shot" else 1)

    warnings = []
    if removed_duplicates:
        warnings.append(
            f"Removed {removed_duplicates} duplicate model event"
            f"{'s' if removed_duplicates != 1 else ''}."
        )
    return unique, warnings


def _jersey_number_words(value: int) -> str | None:
    if value in NUMBER_WORDS:
        return NUMBER_WORDS[value]
    tens = value // 10 * 10
    ones = value % 10
    if tens not in TENS_WORDS:
        return None
    return (
        TENS_WORDS[tens]
        if not ones
        else f"{TENS_WORDS[tens]} {NUMBER_WORDS[ones]}"
    )


def _subject_variants(
    context: dict,
    *,
    active_only: bool = True,
) -> dict[str, str]:
    active_ids = set(context["currentLineupIds"])
    variants: dict[str, set[str]] = {}
    for player in context["roster"]:
        if active_only and player["id"] not in active_ids:
            continue
        jersey = str(player["jersey"]).strip().lower()
        if not jersey:
            continue
        variants.setdefault(jersey, set()).add(player["id"])
        if jersey.isdigit():
            words = _jersey_number_words(int(jersey))
            if words:
                variants.setdefault(words, set()).add(player["id"])
    return {
        variant: next(iter(player_ids))
        for variant, player_ids in variants.items()
        if len(player_ids) == 1
    }


def _mentions_substitution(transcript: str) -> bool:
    return bool(
        re.search(
            r"\b(?:sub|subs|substitute|substitutes|substitution|in\s+for)\b",
            transcript,
            re.IGNORECASE,
        )
    )


def _interpret_explicit_substitution(
    transcript: str,
    context: dict,
    model_name: str,
) -> InterpretationResult | None:
    resolved = _subject_variants(context, active_only=False)
    if not resolved:
        return None
    player_pattern = "|".join(
        re.escape(variant)
        for variant in sorted(resolved, key=len, reverse=True)
    )
    subject = rf"(?:(?:number|player)\s+)?(?P<{{name}}>{player_pattern})"
    normalized = " ".join(
        re.sub(r"[,.!?]+", " ", transcript.lower()).split()
    )
    patterns = [
        re.compile(
            rf"^{subject.format(name='incoming')}\s+"
            r"(?:subs?|substitutes?|checks?\s+in|in)\s+for\s+"
            rf"{subject.format(name='outgoing')}$"
        ),
        re.compile(
            r"^(?:sub|substitute)\s+"
            rf"{subject.format(name='outgoing')}\s+out\s+for\s+"
            rf"{subject.format(name='incoming')}$"
        ),
    ]
    match = next((pattern.fullmatch(normalized) for pattern in patterns), None)
    if not match:
        return None
    incoming_id = resolved[match.group("incoming")]
    outgoing_id = resolved[match.group("outgoing")]
    active_ids = set(context["currentLineupIds"])
    if outgoing_id not in active_ids:
        raise InvalidInterpretation(
            "The outgoing substitution player is not on court."
        )
    if incoming_id in active_ids:
        raise InvalidInterpretation(
            "The incoming substitution player is already on court."
        )
    if incoming_id == outgoing_id:
        raise InvalidInterpretation(
            "The incoming and outgoing substitution players must differ."
        )
    return InterpretationResult(
        events=[
            {
                "side": "team",
                "type": "substitution",
                "playerId": None,
                "playerInId": incoming_id,
                "playerOutId": outgoing_id,
                "confidence": 0.99,
            }
        ],
        overall_confidence=0.99,
        warnings=[],
        model=model_name,
    )


def _event_type_for_action(action: str) -> str:
    normalized = action.lower()
    if normalized.startswith(("make", "made", "miss", "score")):
        return "shot"
    if normalized.startswith("assist"):
        return "assist"
    if normalized.startswith("rebound"):
        return "rebound"
    if normalized.startswith("steal"):
        return "steal"
    if normalized.startswith("block"):
        return "block"
    if normalized.startswith("turnover"):
        return "turnover"
    if normalized.startswith("foul"):
        return "foul"
    return "timeout"


def _explicit_event_facts(transcript: str, context: dict) -> list[dict]:
    resolved = _subject_variants(context)
    jersey_pattern = "|".join(
        re.escape(variant)
        for variant in sorted(resolved, key=len, reverse=True)
    )
    subject_options = r"opponent|opponents|opposing\s+team"
    if jersey_pattern:
        subject_options += rf"|(?:(?:number|player)\s+)?(?:{jersey_pattern})"
    subject_pattern = rf"(?P<subject>{subject_options})"
    action_pattern = (
        r"(?P<action>assist(?:s|ed)?|make|makes|made|miss|misses|missed|"
        r"score|scores|scored|rebound|rebounds|steal|steals|block|blocks|"
        r"turnover|turnovers|foul|fouls|timeout)"
    )
    before_pattern = re.compile(
        rf"\b{subject_pattern}\s+(?:offensive\s+|defensive\s+)?"
        rf"{action_pattern}\b",
        re.IGNORECASE,
    )
    after_pattern = re.compile(
        rf"\b(?:offensive\s+|defensive\s+)?{action_pattern}\s+by\s+"
        rf"{subject_pattern}\b",
        re.IGNORECASE,
    )
    facts = []
    seen = set()
    for placement, pattern in (
        ("before", before_pattern),
        ("after", after_pattern),
    ):
        for match in pattern.finditer(transcript):
            subject = match.group("subject").lower()
            preceding = transcript[max(0, match.start() - 32):match.start()].lower()
            if subject.startswith(("opponent", "opposing team")):
                if placement == "before" and re.search(r"\bby\s*$", preceding):
                    continue
                side = "opponent"
                player_id = None
            else:
                if placement == "before" and re.search(
                    r"\b(?:opponent|opponents|opposing\s+team)\s*"
                    r"(?:number|player)?\s*$",
                    preceding,
                ):
                    continue
                side = "team"
                jersey = re.sub(r"^(?:number|player)\s+", "", subject)
                player_id = resolved.get(jersey)
                if not player_id:
                    continue
            event_type = _event_type_for_action(match.group("action"))
            identity = (event_type, match.start(), player_id, side)
            if identity in seen:
                continue
            seen.add(identity)
            facts.append({
                "type": event_type,
                "side": side,
                "playerId": player_id,
                "start": match.start(),
            })
    return sorted(facts, key=lambda fact: fact["start"])


def _spoken_event_types(transcript: str) -> set[str]:
    normalized = transcript.lower()
    padded = f" {normalized} "
    keywords = {
        "assist": ("assist",),
        "rebound": ("rebound",),
        "steal": ("steal", "stole"),
        "block": ("block",),
        "turnover": ("turnover", "turned it over"),
        "foul": ("foul",),
        "timeout": ("timeout",),
        "substitution": (" sub ", " subs ", "substitute", " in for "),
        "shot": (
            " makes ",
            " made ",
            " misses ",
            " missed ",
            " scores ",
            " scored ",
            "free throw",
        ),
    }
    return {
        event_type
        for event_type, phrases in keywords.items()
        if any(phrase in padded for phrase in phrases)
    }


def _ground_model_payload(transcript: str, payload: object, context: dict):
    if not isinstance(payload, dict) or not isinstance(payload.get("events"), list):
        return payload
    grounded = json.loads(json.dumps(payload))
    warnings = grounded.get("warnings")
    if not isinstance(warnings, list):
        return grounded
    spoken_types = _spoken_event_types(transcript)
    original_count = len(grounded["events"])
    grounded["events"] = [
        event
        for event in grounded["events"]
        if not isinstance(event, dict)
        or event.get("type") in spoken_types
    ]
    removed = original_count - len(grounded["events"])
    if removed:
        warnings.append(
            f"Removed {removed} unspoken model event"
            f"{'s' if removed != 1 else ''}."
        )

    facts = _explicit_event_facts(transcript, context)
    recoverable_types = {
        "steal",
        "block",
        "turnover",
        "foul",
        "timeout",
    }
    recoverable_in_order = dict.fromkeys(
        fact["type"]
        for fact in facts
        if fact["type"] in recoverable_types
    )
    for event_type in recoverable_in_order:
        type_facts = [fact for fact in facts if fact["type"] == event_type]
        type_events = [
            event
            for event in grounded["events"]
            if isinstance(event, dict) and event.get("type") == event_type
        ]
        if not type_facts or type_events:
            continue
        for fact in type_facts:
            grounded["events"].append({
                "side": fact["side"],
                "type": event_type,
                "playerId": fact["playerId"],
                "confidence": 0.99,
            })
        warnings.append(
            f"Recovered {len(type_facts)} explicitly spoken {event_type} "
            f"event{'s' if len(type_facts) != 1 else ''} omitted by the "
            "command model."
        )
    jerseys_by_id = {
        player["id"]: str(player["jersey"])
        for player in context["roster"]
    }
    for event_type in {fact["type"] for fact in facts}:
        type_facts = [fact for fact in facts if fact["type"] == event_type]
        type_events = [
            event
            for event in grounded["events"]
            if isinstance(event, dict) and event.get("type") == event_type
        ]
        if len(type_facts) != len(type_events):
            continue
        for event, fact in zip(type_events, type_facts):
            if (
                event.get("side") == fact["side"]
                and event.get("playerId") == fact["playerId"]
            ):
                continue
            event["side"] = fact["side"]
            event["playerId"] = fact["playerId"]
            subject = (
                "opponent"
                if fact["side"] == "opponent"
                else f"jersey {jerseys_by_id[fact['playerId']]}"
            )
            warnings.append(
                f"Corrected {event_type} attribution to {subject} "
                "from the explicit transcript."
            )
    return grounded


def _ground_explicit_transcript_facts(
    transcript: str,
    result: InterpretationResult,
    context: dict,
) -> InterpretationResult:
    events = [
        {
            **event,
            **(
                {"shotDetails": dict(event["shotDetails"])}
                if "shotDetails" in event
                else {}
            ),
        }
        for event in result.events
    ]
    warnings = list(result.warnings)
    normalized = re.sub(r"[-_]+", " ", transcript.lower())
    facts = _explicit_event_facts(transcript, context)
    shot_facts = [fact for fact in facts if fact["type"] == "shot"]
    shot_events = [event for event in events if event["type"] == "shot"]
    fact_boundaries = [
        (
            fact["start"],
            facts[index + 1]["start"] if index + 1 < len(facts) else len(normalized),
        )
        for index, fact in enumerate(facts)
    ]
    shot_segments = [
        normalized[start:end]
        for fact, (start, end) in zip(facts, fact_boundaries)
        if fact["type"] == "shot"
    ]
    for index, event in enumerate(shot_events):
        details = event.get("shotDetails")
        phase = details.get("phase") if isinstance(details, dict) else None
        if not phase:
            continue
        segment = (
            shot_segments[index]
            if len(shot_segments) == len(shot_events)
            else ""
        )
        has_evidence = (
            bool(re.search(r"\btransition\b|\bfast\s+break\b", segment))
            if phase == "transition"
            else bool(re.search(r"\bhalf\s+court\b", segment))
        )
        if has_evidence:
            continue
        del details["phase"]
        if not details:
            del event["shotDetails"]
        warnings.append(
            f"Removed unspoken shot phase '{phase.replace('_', ' ')}'."
        )

    return InterpretationResult(
        events=events,
        overall_confidence=result.overall_confidence,
        warnings=warnings,
        model=result.model,
    )


def _is_confidence(value: object) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and 0 <= value <= 1
    )


def _field_error(label: str, unexpected: list[str], missing: list[str]) -> str:
    details = []
    if unexpected:
        details.append(f"unsupported fields: {', '.join(unexpected)}")
    if missing:
        details.append(f"missing fields: {', '.join(missing)}")
    return f"{label} has {'; '.join(details)}."


def _validate_spoken_event_coverage(
    transcript: str,
    result: InterpretationResult,
):
    spoken_types = _spoken_event_types(transcript)
    proposed_types = {event["type"] for event in result.events}
    missing = sorted(spoken_types - proposed_types)
    if missing and not result.warnings:
        raise InvalidInterpretation(
            "Command model silently omitted explicitly spoken event types: "
            f"{', '.join(missing)}."
        )


def create_interpreter(
    runtime: str,
    *,
    model_path: Path | None = None,
    context_size: int = 4096,
    gpu_layers: int = 0,
) -> CommandInterpreter:
    fixture = os.environ.get("BASK_VOICE_INTERPRETATION_FIXTURE")
    if fixture:
        try:
            payload = json.loads(fixture)
        except json.JSONDecodeError as error:
            raise ValueError(
                "BASK_VOICE_INTERPRETATION_FIXTURE must be valid JSON."
            ) from error

        class FixtureInterpreter:
            ready = True
            model_name = "fixture"
            state = "ready"

            @staticmethod
            def metadata():
                return {
                    "runtime": "fixture",
                    "model": "fixture",
                    "modelPath": None,
                    "lastError": None,
                }

            @staticmethod
            def interpret(
                transcript: str,
                context: dict,
                cancellation: CancellationSignal | None = None,
            ):
                if cancellation:
                    cancellation.raise_if_cancelled()
                return validate_interpretation(payload, context, "fixture")

        return FixtureInterpreter()
    if runtime == "none":
        return DisabledCommandInterpreter()
    if runtime == "llama-cpp":
        return LlamaCppCommandInterpreter(
            model_path=model_path,
            context_size=context_size,
            gpu_layers=gpu_layers,
        )
    raise ValueError(
        f"Unknown command interpreter runtime '{runtime}'. "
        "Choose 'none' or 'llama-cpp'."
    )
