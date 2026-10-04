from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Callable

from .cancellation import CancellationSignal
from .interpretation import (
    InvalidInterpretation,
    InterpretationResult,
    LlamaCppCommandInterpreter,
    _explicit_event_facts,
    _ground_explicit_transcript_facts,
    _ground_model_payload,
    _interpret_explicit_substitution,
    _mentions_substitution,
    _validate_spoken_event_coverage,
    validate_interpretation,
)


class FactDslCommandInterpreter(LlamaCppCommandInterpreter):
    interpreter_name = "fact-dsl-v2"

    def __init__(
        self,
        *,
        model_path: Path | None = None,
        model_factory: Callable | None = None,
        context_size: int = 4096,
        gpu_layers: int = 0,
    ):
        super().__init__(
            model_path=model_path,
            model_factory=model_factory,
            context_size=context_size,
            gpu_layers=gpu_layers,
        )

    def metadata(self) -> dict:
        return super().metadata()

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
        options = {
            "messages": [
                {"role": "system", "content": self._system_prompt()},
                {
                    "role": "user",
                    "content": self._user_prompt(transcript.strip(), context),
                },
            ],
            "temperature": 0,
            "top_p": 1,
            "seed": 0,
            "max_tokens": 256,
        }
        content = self._complete(model, options, cancellation)
        payload = parse_fact_dsl(content, context)
        payload = _align_payload_to_explicit_facts(
            transcript,
            payload,
            context,
        )
        payload = _ground_model_payload(transcript, payload, context)
        result = validate_interpretation(payload, context, self.model_name)
        result = _ground_explicit_transcript_facts(transcript, result, context)
        _validate_spoken_event_coverage(transcript, result)
        return result

    @staticmethod
    def _complete(model, options: dict, cancellation) -> str:
        if cancellation is None:
            response = model.create_chat_completion(**options)
            try:
                return response["choices"][0]["message"]["content"]
            except (KeyError, IndexError, TypeError) as error:
                raise InvalidInterpretation(
                    "Command model returned an invalid fact response."
                ) from error

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
        return "".join(content_parts)

    @staticmethod
    def _system_prompt() -> str:
        return (
            "/no_think\n"
            "Extract every explicitly spoken basketball statistic into the "
            "compact fact language below. Output only fact lines, with no JSON, "
            "markdown, explanation, or headings. Never invent an event, jersey, "
            "side, shot value, result, rebound kind, or phase. Use one line per "
            "distinct statistic. Put a scoring shot before its related assist.\n"
            "SHOT <TEAM|OPPONENT> <jersey|-> <1|2|3> <MADE|MISSED> "
            "<TRANSITION|HALF_COURT|->\n"
            "REBOUND <TEAM|OPPONENT> <jersey|-> <OFFENSIVE|DEFENSIVE>\n"
            "ASSIST <TEAM|OPPONENT> <jersey|->\n"
            "STEAL <TEAM|OPPONENT> <jersey|->\n"
            "BLOCK <TEAM|OPPONENT> <jersey|->\n"
            "TURNOVER <TEAM|OPPONENT> <jersey|->\n"
            "FOUL <TEAM|OPPONENT> <jersey|->\n"
            "TIMEOUT <TEAM|OPPONENT> -\n"
            "Team facts require a supplied roster jersey. Opponent facts always "
            "use '-'. A free throw has value 1. If a required fact is ambiguous, "
            "omit it and output WARN <short reason>.\n"
            "Examples:\n"
            "Transcript: Number 5 makes two points in transition. Number 70 assist.\n"
            "SHOT TEAM 5 2 MADE TRANSITION\n"
            "ASSIST TEAM 70\n"
            "Transcript: Opponent misses three pointer. Number 13 defensive rebound.\n"
            "SHOT OPPONENT - 3 MISSED -\n"
            "REBOUND TEAM 13 DEFENSIVE\n"
            "Transcript: Number 40 turnover. Opponent steal.\n"
            "TURNOVER TEAM 40\n"
            "STEAL OPPONENT -\n"
            "Transcript: Opponent misses free throw.\n"
            "SHOT OPPONENT - 1 MISSED -\n"
            "Transcript: He made it.\n"
            "WARN Player and shot value are ambiguous."
        )

    @staticmethod
    def _user_prompt(transcript: str, context: dict) -> str:
        prompt_context = {
            "roster": [
                {
                    "jersey": player["jersey"],
                    "onCourt": player["id"] in context["currentLineupIds"],
                }
                for player in context["roster"]
            ],
            "sideHint": context.get("sideHint"),
            "allowedEventTypes": context["allowedEventTypes"],
        }
        return (
            f"Context: {json.dumps(prompt_context, separators=(',', ':'))}\n"
            f"Transcript: {transcript}\n"
            "Facts:"
        )


def parse_fact_dsl(content: str, context: dict) -> dict:
    if not isinstance(content, str) or not content.strip():
        raise InvalidInterpretation("Command model returned no basketball facts.")
    content = re.sub(
        r"^\s*<think>.*?</think>\s*",
        "",
        content,
        count=1,
        flags=re.DOTALL | re.IGNORECASE,
    )
    if not content.strip():
        raise InvalidInterpretation("Command model returned no basketball facts.")

    jersey_ids: dict[str, set[str]] = {}
    for player in context["roster"]:
        jersey_ids.setdefault(str(player["jersey"]).lower(), set()).add(
            player["id"]
        )

    events = []
    warnings = []
    for line_number, raw_line in enumerate(content.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line in {"```", "```text"}:
            continue
        if line.upper().startswith("WARN "):
            warning = line[5:].strip()
            if warning:
                warnings.append(warning)
            continue
        tokens = line.split()
        event_type = tokens[0].upper()
        try:
            event = _parse_fact_tokens(
                event_type,
                tokens,
                jersey_ids,
                line_number,
            )
        except (IndexError, ValueError) as error:
            raise InvalidInterpretation(
                f"Invalid fact on line {line_number}: {line}"
            ) from error
        events.append(event)

    if len(events) > 20:
        raise InvalidInterpretation("Command model returned too many facts.")
    if len(warnings) > 20:
        raise InvalidInterpretation("Command model returned too many warnings.")
    return {
        "events": events,
        "overallConfidence": 0.99 if events else None,
        "warnings": warnings,
    }


def _align_payload_to_explicit_facts(
    transcript: str,
    payload: dict,
    context: dict,
) -> dict:
    facts = _explicit_event_facts(transcript, context)
    events = payload["events"]
    if not facts:
        return payload
    available = set(range(len(events)))
    assignments = {}
    for fact_index, fact in enumerate(facts):
        exact = [
            index
            for index in available
            if (
                events[index].get("type") == fact["type"]
                and events[index].get("side") == fact["side"]
                and events[index].get("playerId") == fact["playerId"]
            )
        ]
        if exact:
            assignments[fact_index] = exact[0]
            available.remove(exact[0])
    selected = []
    corrections = 0
    for fact_index, fact in enumerate(facts):
        if fact_index in assignments:
            index = assignments[fact_index]
        else:
            candidates = [
                index
                for index in available
                if events[index].get("type") == fact["type"]
            ]
            if not candidates:
                return payload
            index = max(
                candidates,
                key=lambda candidate: (
                    events[candidate].get("side") == fact["side"],
                    events[candidate].get("playerId") == fact["playerId"],
                    -candidate,
                ),
            )
            available.remove(index)
        event = dict(events[index])
        if (
            event.get("side") != fact["side"]
            or event.get("playerId") != fact["playerId"]
        ):
            corrections += 1
        event["side"] = fact["side"]
        event["playerId"] = fact["playerId"]
        if fact["type"] == "rebound" and fact.get("reboundKind"):
            if event.get("reboundKind") != fact["reboundKind"]:
                corrections += 1
            event["reboundKind"] = fact["reboundKind"]
        selected.append(event)

    removed = len(events) - len(selected)
    payload["events"] = selected
    if corrections:
        payload["warnings"].append(
            f"Aligned {corrections} DSL fact field"
            f"{'s' if corrections != 1 else ''} to the explicit transcript."
        )
    if removed:
        payload["warnings"].append(
            f"Removed {removed} extra DSL fact"
            f"{'s' if removed != 1 else ''}."
        )
    return payload


def _parse_fact_tokens(
    event_type: str,
    tokens: list[str],
    jersey_ids: dict[str, set[str]],
    line_number: int,
) -> dict:
    if event_type == "SHOT":
        if len(tokens) != 6:
            raise ValueError("SHOT requires five values.")
        event = _base_event("shot", tokens[1], tokens[2], jersey_ids)
        shot_value = int(tokens[3])
        if shot_value not in {1, 2, 3}:
            raise ValueError("Unsupported shot value.")
        made = tokens[4].upper()
        if made not in {"MADE", "MISSED"}:
            raise ValueError("Unsupported shot result.")
        event.update({"shotValue": shot_value, "made": made == "MADE"})
        phase = tokens[5].upper()
        if phase not in {"-", "TRANSITION", "HALF_COURT"}:
            raise ValueError("Unsupported shot phase.")
        if phase != "-":
            event["shotDetails"] = {"phase": phase.lower()}
        return event
    if event_type == "REBOUND":
        if len(tokens) != 4:
            raise ValueError("REBOUND requires three values.")
        event = _base_event("rebound", tokens[1], tokens[2], jersey_ids)
        rebound_kind = tokens[3].upper()
        if rebound_kind not in {"OFFENSIVE", "DEFENSIVE"}:
            raise ValueError("Unsupported rebound kind.")
        event["reboundKind"] = rebound_kind.lower()
        return event
    simple_types = {
        "ASSIST": "assist",
        "STEAL": "steal",
        "BLOCK": "block",
        "TURNOVER": "turnover",
        "FOUL": "foul",
        "TIMEOUT": "timeout",
    }
    if len(tokens) == 4 and tokens[3] == "-":
        tokens = tokens[:3]
    if event_type not in simple_types or len(tokens) != 3:
        raise ValueError(f"Unsupported fact type on line {line_number}.")
    return _base_event(
        simple_types[event_type],
        tokens[1],
        tokens[2],
        jersey_ids,
    )


def _base_event(
    event_type: str,
    side_token: str,
    jersey_token: str,
    jersey_ids: dict[str, set[str]],
) -> dict:
    side = side_token.lower()
    if side not in {"team", "opponent"}:
        raise ValueError("Unsupported side.")
    if jersey_token == "-":
        player_id = None
    else:
        player_ids = jersey_ids.get(jersey_token.lower(), set())
        if len(player_ids) != 1:
            raise ValueError("Team jersey is missing or ambiguous.")
        player_id = next(iter(player_ids))
    return {
        "side": side,
        "type": event_type,
        "playerId": player_id,
        "confidence": 0.99,
    }
