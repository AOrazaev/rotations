from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Protocol

from .config import ALLOWED_EVENT_TYPES
from .profiles import default_model_directory


MAX_PROPOSED_EVENTS = 20
MAX_WARNINGS = 20
DEFAULT_COMMAND_MODEL = "Qwen3-4B-Q4_K_M.gguf"
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

    def interpret(self, transcript: str, context: dict) -> InterpretationResult: ...


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

    def interpret(self, transcript: str, context: dict) -> InterpretationResult:
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

    def interpret(self, transcript: str, context: dict) -> InterpretationResult:
        if not isinstance(transcript, str) or not transcript.strip():
            raise InvalidInterpretation("Transcript must be a non-empty string.")
        model = self._load_model()
        response = model.create_chat_completion(
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
        try:
            content = response["choices"][0]["message"]["content"]
            payload = json.loads(content)
        except (KeyError, IndexError, TypeError, json.JSONDecodeError) as error:
            raise InvalidInterpretation(
                "Command model returned an invalid structured response."
            ) from error
        result = validate_interpretation(payload, context, self.model_name)
        _validate_spoken_event_coverage(transcript, result)
        return result

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
            "For 'A assist and B makes two', emit B's shot and A's assist."
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
    optional = {"shotValue", "made", "reboundKind", "shotDetails"}
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
        _reject_fields(event, index, {"shotValue", "made", "shotDetails"})
    else:
        _reject_fields(
            event,
            index,
            {"shotValue", "made", "reboundKind", "shotDetails"},
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
    normalized = transcript.lower()
    spoken_types = set()
    keywords = {
        "assist": ("assist",),
        "rebound": ("rebound",),
        "steal": ("steal", "stole"),
        "block": ("block",),
        "turnover": ("turnover", "turned it over"),
        "foul": ("foul",),
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
    padded = f" {normalized} "
    for event_type, phrases in keywords.items():
        if any(phrase in padded for phrase in phrases):
            spoken_types.add(event_type)
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
            def interpret(transcript: str, context: dict):
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
