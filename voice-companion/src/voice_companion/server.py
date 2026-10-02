from __future__ import annotations

import argparse
import json
import mimetypes
import os
import secrets
import subprocess
import threading
import time
from email.parser import BytesParser
from email.policy import default
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from . import __version__
from .cancellation import CancellationSignal, ProcessingCancelled
from .config import (
    ALLOWED_AUDIO_TYPES,
    DEFAULT_ALLOWED_ORIGINS,
    PROTOCOL_VERSION,
    ServiceSettings,
)
from .interpretation import (
    CommandInterpreter,
    DisabledCommandInterpreter,
    InterpretationResult,
    InterpretationUnavailable,
    InvalidInterpretation,
    create_interpreter,
)
from .hardware import detect_hardware
from .transcription import (
    Transcriber,
    TranscriptionUnavailable,
    create_transcriber,
)
from .validation import RequestValidationError, validate_context
from .profiles import default_model_directory, resolve_profile


class VoiceCompanionServer(ThreadingHTTPServer):
    def __init__(
        self,
        server_address,
        handler_class,
        *,
        settings: ServiceSettings,
        web_root: Path,
        transcriber: Transcriber,
        interpreter: CommandInterpreter,
    ):
        super().__init__(server_address, handler_class)
        self.settings = settings
        self.web_root = web_root
        self.transcriber = transcriber
        self.interpreter = interpreter
        self.hardware = detect_hardware()
        self.started_at = time.monotonic()
        self.processing_slots = threading.BoundedSemaphore(
            settings.max_concurrent_requests
        )
        self.processing_lock = threading.Lock()
        self.processing_requests = 0
        self.cancellations: dict[str, CancellationSignal] = {}

    def begin_processing(self) -> bool:
        if not self.processing_slots.acquire(blocking=False):
            return False
        with self.processing_lock:
            self.processing_requests += 1
        return True

    def end_processing(self):
        with self.processing_lock:
            self.processing_requests -= 1
        self.processing_slots.release()

    def register_request(self, request_id: str) -> CancellationSignal:
        signal = CancellationSignal()
        with self.processing_lock:
            if request_id in self.cancellations:
                raise ValueError("requestId is already being processed.")
            self.cancellations[request_id] = signal
        return signal

    def finish_active_request(self, request_id: str):
        with self.processing_lock:
            self.cancellations.pop(request_id, None)

    def cancel_request(self, request_id: str) -> bool:
        with self.processing_lock:
            signal = self.cancellations.get(request_id)
        return signal.cancel() if signal else False


class VoiceCompanionHandler(BaseHTTPRequestHandler):
    server: VoiceCompanionServer

    def do_OPTIONS(self):
        origin = self.headers.get("Origin")
        if not self._origin_allowed(origin):
            self._send_error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "Origin is not allowed.")
            return
        self.send_response(HTTPStatus.NO_CONTENT)
        self._write_cors_headers(origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type, X-Bask-Voice-Token",
        )
        if self.headers.get("Access-Control-Request-Private-Network") == "true":
            self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Max-Age", "600")
        self.end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/v1/health":
            if not self._authorize_api():
                return
            transcription_state = self._transcription_state()
            interpretation_state = self._interpretation_state()
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": self._service_status(transcription_state),
                    "protocolVersion": PROTOCOL_VERSION,
                    "serviceVersion": __version__,
                    "profile": self.server.settings.profile,
                    "transcriptionReady": transcription_state == "ready",
                    "transcriptionState": transcription_state,
                    "commandModelReady": interpretation_state == "ready",
                    "commandModelState": interpretation_state,
                    "processingRequests": self.server.processing_requests,
                    "uptimeSeconds": round(
                        time.monotonic() - self.server.started_at, 1
                    ),
                },
            )
            return
        if path == "/v1/capabilities":
            if not self._authorize_api():
                return
            transcription_metadata = self._transcription_metadata()
            interpretation_metadata = self._interpretation_metadata()
            self._send_json(
                HTTPStatus.OK,
                {
                    "protocolVersion": PROTOCOL_VERSION,
                    "audioTypes": sorted(ALLOWED_AUDIO_TYPES),
                    "languages": ["en"],
                    "maxAudioBytes": self.server.settings.max_audio_bytes,
                    "maxContextBytes": self.server.settings.max_context_bytes,
                    "maxDurationSeconds": self.server.settings.max_duration_seconds,
                    "maxConcurrentRequests": (
                        self.server.settings.max_concurrent_requests
                    ),
                    "transcriptionModel": self.server.transcriber.model_name,
                    "transcription": transcription_metadata,
                    "commandModel": self.server.interpreter.model_name,
                    "interpretation": interpretation_metadata,
                    "eventInterpretation": (
                        interpretation_metadata["runtime"] != "disabled"
                    ),
                    "hardware": self.server.hardware,
                    "security": {
                        "loopbackOnly": True,
                        "tokenRequired": True,
                        "originValidation": True,
                    },
                },
            )
            return
        if path == "/v1/diagnostics":
            if not self._authorize_api():
                return
            self._send_json(
                HTTPStatus.OK,
                self._diagnostics(),
            )
            return
        self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in {
            "/v1/voice-command",
            "/v1/interpret-command",
            "/v1/warmup",
            "/v1/cancel",
        }:
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "Endpoint was not found.")
            return
        if not self._authorize_api():
            return
        if path == "/v1/cancel":
            self._handle_cancel()
            return
        if path == "/v1/warmup":
            self._handle_warmup()
            return
        if path == "/v1/interpret-command":
            self._handle_interpret_command()
            return
        self._handle_voice_command()

    def _handle_cancel(self):
        content_length = self._content_length()
        if content_length is None:
            return
        if content_length > 1024:
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "Cancellation request exceeds the configured limit.",
            )
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "invalid_request",
                "Cancellation body must be valid JSON.",
            )
            return
        if (
            not isinstance(payload, dict)
            or set(payload) != {"requestId"}
            or not isinstance(payload["requestId"], str)
            or not payload["requestId"]
        ):
            self._send_error(
                HTTPStatus.BAD_REQUEST,
                "invalid_request",
                "Cancellation requires one non-empty requestId.",
            )
            return
        cancelled = self.server.cancel_request(payload["requestId"])
        self._send_json(
            HTTPStatus.ACCEPTED if cancelled else HTTPStatus.NOT_FOUND,
            {
                "requestId": payload["requestId"],
                "status": "cancellation_requested" if cancelled else "not_active",
            },
        )

    def _handle_warmup(self):
        content_length = self._content_length()
        if content_length is None:
            return
        if content_length > 1024:
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "Warmup request exceeds the configured limit.",
            )
            return
        if content_length:
            try:
                payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                self._send_error(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_request",
                    "Warmup body must be valid JSON.",
                )
                return
            if payload != {}:
                self._send_error(
                    HTTPStatus.BAD_REQUEST,
                    "invalid_request",
                    "Warmup request does not accept options.",
                )
                return
        if not self.server.begin_processing():
            self._send_error(
                HTTPStatus.TOO_MANY_REQUESTS,
                "service_busy",
                "The voice companion is already processing a request.",
            )
            return

        started = time.perf_counter()
        timings = {}
        try:
            timings["transcription"] = self._warm_adapter(
                self.server.transcriber,
            )
            timings["interpretation"] = self._warm_adapter(
                self.server.interpreter,
            )
        except (TranscriptionUnavailable, InterpretationUnavailable) as error:
            self._send_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "warmup_unavailable",
                str(error),
                stage="warmup",
            )
            return
        except (RuntimeError, OSError, ValueError) as error:
            self._send_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "warmup_failed",
                str(error),
                stage="warmup",
            )
            return
        finally:
            self.server.end_processing()

        timings["total"] = round((time.perf_counter() - started) * 1000)
        self._send_json(
            HTTPStatus.OK,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "status": "ready",
                "profile": self.server.settings.profile,
                "transcription": self._transcription_metadata(),
                "interpretation": self._interpretation_metadata(),
                "hardware": self.server.hardware,
                "timingMs": timings,
            },
        )

    @staticmethod
    def _warm_adapter(adapter) -> int:
        started = time.perf_counter()
        warmup = getattr(adapter, "warmup", None)
        if callable(warmup):
            warmup()
        return round((time.perf_counter() - started) * 1000)

    def _handle_voice_command(self):
        content_length = self._content_length()
        if content_length is None:
            return
        if content_length > (
            self.server.settings.max_audio_bytes
            + self.server.settings.max_context_bytes
            + 64 * 1024
        ):
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "Voice command request exceeds the configured limit.",
            )
            return
        content_type = self.headers.get("Content-Type", "")
        if not content_type.startswith("multipart/form-data;"):
            self._send_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "multipart_required",
                "Use multipart/form-data with audio and context parts.",
            )
            return

        body = self.rfile.read(content_length)
        try:
            context, audio, audio_type = self._parse_multipart(content_type, body)
            validate_context(context)
        except (ValueError, RequestValidationError) as error:
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_request", str(error))
            return

        if audio_type not in ALLOWED_AUDIO_TYPES:
            self._send_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "unsupported_audio_type",
                f"Unsupported audio type: {audio_type or 'missing'}.",
            )
            return
        if len(audio) > self.server.settings.max_audio_bytes:
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "audio_too_large",
                "Audio exceeds the configured limit.",
            )
            return

        if not self.server.begin_processing():
            self._send_error(
                HTTPStatus.TOO_MANY_REQUESTS,
                "service_busy",
                "The voice companion is already processing a request.",
            )
            return

        started = time.perf_counter()
        stage = "transcription"
        cancellation = None
        timeout_timer = None
        try:
            cancellation = self.server.register_request(context["requestId"])
            timeout_timer = self._start_timeout(cancellation)
            transcription_started = time.perf_counter()
            transcription = self.server.transcriber.transcribe(
                audio, ALLOWED_AUDIO_TYPES[audio_type]
            )
            cancellation.raise_if_cancelled()
            transcription_ms = round(
                (time.perf_counter() - transcription_started) * 1000
            )
            stage = "interpretation"
            interpretation_started = time.perf_counter()
            interpretation = self._interpret_or_placeholder(
                transcription.text,
                context,
                cancellation,
            )
            interpretation_ms = round(
                (time.perf_counter() - interpretation_started) * 1000
            )
        except TranscriptionUnavailable as error:
            self._send_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "transcription_not_configured",
                str(error),
            )
            return
        except InterpretationUnavailable as error:
            self._send_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "interpretation_not_configured",
                str(error),
                stage="interpretation",
                partial_result=self._transcription_partial(
                    context,
                    transcription,
                    transcription_ms,
                    started,
                ),
            )
            return
        except InvalidInterpretation as error:
            self._send_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "interpretation_failed",
                str(error),
                stage="interpretation",
                partial_result=self._transcription_partial(
                    context,
                    transcription,
                    transcription_ms,
                    started,
                ),
            )
            return
        except ProcessingCancelled as error:
            self._send_error(
                HTTPStatus.REQUEST_TIMEOUT
                if error.reason == "timeout"
                else HTTPStatus.CONFLICT,
                "processing_timeout"
                if error.reason == "timeout"
                else "request_cancelled",
                str(error),
                stage=stage,
                partial_result=(
                    self._transcription_partial(
                        context,
                        transcription,
                        transcription_ms,
                        started,
                    )
                    if stage == "interpretation"
                    else None
                ),
            )
            return
        except MemoryError as error:
            self._send_error(
                HTTPStatus.INSUFFICIENT_STORAGE,
                "model_out_of_memory",
                str(error) or "The local model ran out of memory.",
                stage=stage,
            )
            return
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            partial_result = (
                self._transcription_partial(
                    context,
                    transcription,
                    transcription_ms,
                    started,
                )
                if stage == "interpretation"
                else None
            )
            self._send_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                (
                    "interpretation_failed"
                    if stage == "interpretation"
                    else "transcription_failed"
                ),
                str(error),
                stage=stage,
                partial_result=partial_result,
            )
            return
        finally:
            if timeout_timer:
                timeout_timer.cancel()
            if cancellation:
                self.server.finish_active_request(context["requestId"])
            self.server.end_processing()

        total_ms = round((time.perf_counter() - started) * 1000)
        self._send_json(
            HTTPStatus.OK,
            self._command_response(
                context=context,
                transcript=transcription.text,
                transcription_model=transcription.model,
                transcription_ms=transcription_ms,
                interpretation=interpretation,
                interpretation_ms=interpretation_ms,
                total_ms=total_ms,
            ),
        )

    def _handle_interpret_command(self):
        content_length = self._content_length()
        if content_length is None:
            return
        if content_length > self.server.settings.max_context_bytes:
            self._send_error(
                HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                "request_too_large",
                "Interpretation request exceeds the configured limit.",
            )
            return
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            self._send_error(
                HTTPStatus.UNSUPPORTED_MEDIA_TYPE,
                "json_required",
                "Use application/json for transcript interpretation.",
            )
            return
        try:
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            transcript, context = self._validate_interpret_request(payload)
            validate_context(context)
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError, RequestValidationError) as error:
            self._send_error(HTTPStatus.BAD_REQUEST, "invalid_request", str(error))
            return
        if not self.server.begin_processing():
            self._send_error(
                HTTPStatus.TOO_MANY_REQUESTS,
                "service_busy",
                "The voice companion is already processing a request.",
            )
            return

        started = time.perf_counter()
        cancellation = None
        timeout_timer = None
        try:
            cancellation = self.server.register_request(context["requestId"])
            timeout_timer = self._start_timeout(cancellation)
            interpretation_started = time.perf_counter()
            interpretation = self.server.interpreter.interpret(
                transcript,
                context,
                cancellation,
            )
            interpretation_ms = round(
                (time.perf_counter() - interpretation_started) * 1000
            )
        except InterpretationUnavailable as error:
            self._send_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "interpretation_not_configured",
                str(error),
            )
            return
        except ProcessingCancelled as error:
            self._send_error(
                HTTPStatus.REQUEST_TIMEOUT
                if error.reason == "timeout"
                else HTTPStatus.CONFLICT,
                "processing_timeout"
                if error.reason == "timeout"
                else "request_cancelled",
                str(error),
                stage="interpretation",
            )
            return
        except MemoryError as error:
            self._send_error(
                HTTPStatus.INSUFFICIENT_STORAGE,
                "model_out_of_memory",
                str(error) or "The local model ran out of memory.",
                stage="interpretation",
            )
            return
        except (InvalidInterpretation, RuntimeError) as error:
            self._send_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "interpretation_failed",
                str(error),
            )
            return
        finally:
            if timeout_timer:
                timeout_timer.cancel()
            if cancellation:
                self.server.finish_active_request(context["requestId"])
            self.server.end_processing()

        total_ms = round((time.perf_counter() - started) * 1000)
        self._send_json(
            HTTPStatus.OK,
            self._command_response(
                context=context,
                transcript=transcript,
                transcription_model=None,
                transcription_ms=0,
                interpretation=interpretation,
                interpretation_ms=interpretation_ms,
                total_ms=total_ms,
            ),
        )

    def _interpret_or_placeholder(
        self,
        transcript: str,
        context: dict,
        cancellation: CancellationSignal,
    ) -> InterpretationResult:
        if isinstance(self.server.interpreter, DisabledCommandInterpreter):
            return InterpretationResult(
                events=[],
                overall_confidence=None,
                warnings=["Local command interpretation is not configured."],
                model=None,
            )
        return self.server.interpreter.interpret(
            transcript,
            context,
            cancellation,
        )

    def _start_timeout(
        self,
        cancellation: CancellationSignal,
    ) -> threading.Timer:
        timer = threading.Timer(
            self.server.settings.max_processing_seconds,
            cancellation.cancel,
            kwargs={"reason": "timeout"},
        )
        timer.daemon = True
        timer.start()
        return timer

    def _command_response(
        self,
        *,
        context: dict,
        transcript: str,
        transcription_model: str | None,
        transcription_ms: int,
        interpretation: InterpretationResult,
        interpretation_ms: int,
        total_ms: int,
    ) -> dict:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": context["requestId"],
            "transcript": transcript,
            "events": interpretation.events,
            "overallConfidence": interpretation.overall_confidence,
            "warnings": interpretation.warnings,
            "processor": {
                "transcriptionModel": transcription_model,
                "commandModel": interpretation.model,
                "profile": self.server.settings.profile,
            },
            "timingMs": {
                "transcription": transcription_ms,
                "interpretation": interpretation_ms,
                "total": total_ms,
            },
        }

    def _transcription_partial(
        self,
        context: dict,
        transcription,
        transcription_ms: int,
        started: float,
    ) -> dict:
        return {
            "protocolVersion": PROTOCOL_VERSION,
            "requestId": context["requestId"],
            "transcript": transcription.text,
            "processor": {
                "transcriptionModel": transcription.model,
                "commandModel": self.server.interpreter.model_name,
                "profile": self.server.settings.profile,
            },
            "timingMs": {
                "transcription": transcription_ms,
                "totalBeforeFailure": round(
                    (time.perf_counter() - started) * 1000
                ),
            },
        }

    @staticmethod
    def _validate_interpret_request(payload: object) -> tuple[str, dict]:
        if not isinstance(payload, dict):
            raise ValueError("Interpretation request must be a JSON object.")
        required = {"transcript", "context"}
        unexpected = sorted(set(payload) - required)
        missing = sorted(required - set(payload))
        if unexpected:
            raise ValueError(
                f"Interpretation request has unsupported fields: "
                f"{', '.join(unexpected)}."
            )
        if missing:
            raise ValueError(
                f"Interpretation request is missing fields: {', '.join(missing)}."
            )
        transcript = payload["transcript"]
        if (
            not isinstance(transcript, str)
            or not transcript.strip()
            or len(transcript) > 4000
        ):
            raise ValueError(
                "transcript must be a non-empty string of at most 4000 characters."
            )
        return transcript.strip(), payload["context"]

    def _authorize_api(self) -> bool:
        origin = self.headers.get("Origin")
        if not self._origin_allowed(origin):
            self._send_error(HTTPStatus.FORBIDDEN, "origin_not_allowed", "Origin is not allowed.")
            return False
        supplied = self.headers.get("X-Bask-Voice-Token", "")
        if not secrets.compare_digest(supplied, self.server.settings.token):
            self._send_error(
                HTTPStatus.UNAUTHORIZED,
                "unauthorized",
                "A valid voice companion token is required.",
            )
            return False
        return True

    def _transcription_state(self) -> str:
        state = getattr(self.server.transcriber, "state", None)
        if isinstance(state, str):
            return state
        return "ready" if self.server.transcriber.ready else "configuration_required"

    def _transcription_metadata(self) -> dict:
        metadata = getattr(self.server.transcriber, "metadata", None)
        if callable(metadata):
            return metadata()
        return {
            "runtime": "test-adapter",
            "model": self.server.transcriber.model_name,
            "device": None,
            "computeType": None,
            "modelDirectory": None,
        }

    def _diagnostics(self) -> dict:
        transcription = self._transcription_metadata()
        interpretation = self._interpretation_metadata()
        return {
            "formatVersion": 1,
            "protocolVersion": PROTOCOL_VERSION,
            "serviceVersion": __version__,
            "profile": self.server.settings.profile,
            "uptimeSeconds": round(
                time.monotonic() - self.server.started_at,
                1,
            ),
            "processingRequests": self.server.processing_requests,
            "transcription": {
                key: value
                for key, value in transcription.items()
                if key != "modelDirectory"
            },
            "interpretation": {
                key: value
                for key, value in interpretation.items()
                if key != "modelPath"
            },
            "hardware": self.server.hardware,
            "limits": {
                "maxAudioBytes": self.server.settings.max_audio_bytes,
                "maxContextBytes": self.server.settings.max_context_bytes,
                "maxDurationSeconds": self.server.settings.max_duration_seconds,
                "maxConcurrentRequests": (
                    self.server.settings.max_concurrent_requests
                ),
                "maxProcessingSeconds": (
                    self.server.settings.max_processing_seconds
                ),
            },
            "privacy": {
                "containsAudio": False,
                "containsTranscript": False,
                "containsToken": False,
                "containsRoster": False,
                "containsModelPaths": False,
            },
        }

    def _interpretation_state(self) -> str:
        state = getattr(self.server.interpreter, "state", None)
        if isinstance(state, str):
            return state
        return "ready" if self.server.interpreter.ready else "configuration_required"

    def _interpretation_metadata(self) -> dict:
        metadata = getattr(self.server.interpreter, "metadata", None)
        if callable(metadata):
            return metadata()
        return {
            "runtime": "test-adapter",
            "model": self.server.interpreter.model_name,
            "modelPath": None,
            "lastError": None,
        }

    @staticmethod
    def _service_status(transcription_state: str) -> str:
        if transcription_state == "ready":
            return "ready"
        if transcription_state in {"not_loaded", "loading"}:
            return transcription_state
        if transcription_state == "configuration_required":
            return "configuration_required"
        return "error"

    def _origin_allowed(self, origin: str | None) -> bool:
        if origin is None or origin in self.server.settings.allowed_origins:
            return True
        parsed = urlparse(origin)
        return (
            parsed.scheme == "http"
            and parsed.hostname in {"127.0.0.1", "::1", "localhost"}
            and parsed.port == self.server.server_port
        )

    def _content_length(self) -> int | None:
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            length = -1
        if length < 0:
            self._send_error(
                HTTPStatus.LENGTH_REQUIRED,
                "content_length_required",
                "Content-Length is required.",
            )
            return None
        return length

    def _parse_multipart(self, content_type: str, body: bytes):
        message = BytesParser(policy=default).parsebytes(
            f"Content-Type: {content_type}\r\nMIME-Version: 1.0\r\n\r\n".encode()
            + body
        )
        if not message.is_multipart():
            raise ValueError("Malformed multipart request.")

        context = None
        audio = None
        audio_type = None
        for part in message.iter_parts():
            disposition = part.get("Content-Disposition", "")
            name = part.get_param("name", header="Content-Disposition")
            if "form-data" not in disposition or not name:
                continue
            payload = part.get_payload(decode=True) or b""
            if name == "context":
                if len(payload) > self.server.settings.max_context_bytes:
                    raise ValueError("Context exceeds the configured limit.")
                try:
                    context = json.loads(payload.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as error:
                    raise ValueError("Context must be valid UTF-8 JSON.") from error
            elif name == "audio":
                audio = payload
                audio_type = part.get_content_type()

        if context is None:
            raise ValueError("Missing context part.")
        if audio is None or not audio:
            raise ValueError("Missing audio part.")
        return context, audio, audio_type

    def _serve_static(self, path: str):
        relative = "index.html" if path in {"", "/"} else path.lstrip("/")
        requested = (self.server.web_root / relative).resolve()
        try:
            requested.relative_to(self.server.web_root.resolve())
        except ValueError:
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "File was not found.")
            return
        if not requested.is_file():
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "File was not found.")
            return
        content_type = mimetypes.guess_type(requested.name)[0] or "application/octet-stream"
        content = requested.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(content)

    def _write_cors_headers(self, origin: str | None):
        if origin and self._origin_allowed(origin):
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")

    def _send_json(self, status: HTTPStatus, payload: dict):
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._write_cors_headers(self.headers.get("Origin"))
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def _send_error(
        self,
        status: HTTPStatus,
        code: str,
        message: str,
        *,
        stage: str | None = None,
        partial_result: dict | None = None,
    ):
        error = {
            "code": code,
            "message": message,
        }
        if stage:
            error["stage"] = stage
        payload = {"error": error}
        if partial_result is not None:
            payload["partialResult"] = partial_result
        self._send_json(status, payload)

    def log_message(self, format, *args):
        print(f"{self.address_string()} - {format % args}")


def parse_origins(value: str | None) -> set[str]:
    origins = set(DEFAULT_ALLOWED_ORIGINS)
    if value:
        origins.update(item.strip() for item in value.split(",") if item.strip())
    return origins


def build_server(
    *,
    host: str,
    port: int,
    token: str,
    allowed_origins: set[str],
    transcriber: Transcriber | None = None,
    interpreter: CommandInterpreter | None = None,
    max_concurrent_requests: int = 1,
    max_processing_seconds: int = 120,
    profile_name: str = "spike",
) -> VoiceCompanionServer:
    web_root = Path(__file__).resolve().parents[2] / "web"
    settings = ServiceSettings(
        token=token,
        allowed_origins=frozenset(allowed_origins),
        max_concurrent_requests=max_concurrent_requests,
        max_processing_seconds=max_processing_seconds,
        profile=profile_name,
    )
    return VoiceCompanionServer(
        (host, port),
        VoiceCompanionHandler,
        settings=settings,
        web_root=web_root,
        transcriber=transcriber
        or create_transcriber("external-command"),
        interpreter=interpreter or create_interpreter("none"),
    )


def main():
    parser = argparse.ArgumentParser(description="Run the local voice companion spike.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8766)
    parser.add_argument(
        "--token",
        default=os.environ.get("BASK_VOICE_TOKEN") or secrets.token_urlsafe(24),
    )
    parser.add_argument(
        "--allowed-origins",
        default=os.environ.get("BASK_VOICE_ALLOWED_ORIGINS"),
    )
    parser.add_argument(
        "--max-concurrent-requests",
        type=int,
        default=1,
    )
    parser.add_argument(
        "--processing-timeout-seconds",
        type=int,
        default=120,
    )
    parser.add_argument(
        "--transcriber",
        choices=["faster-whisper", "external-command"],
        default=os.environ.get("BASK_VOICE_TRANSCRIBER", "external-command"),
    )
    parser.add_argument(
        "--profile",
        choices=["lightweight", "balanced", "high_accuracy"],
        default=os.environ.get("BASK_VOICE_PROFILE", "balanced"),
    )
    parser.add_argument("--model", default=os.environ.get("BASK_VOICE_MODEL"))
    parser.add_argument("--device", default=os.environ.get("BASK_VOICE_DEVICE"))
    parser.add_argument(
        "--compute-type",
        default=os.environ.get("BASK_VOICE_COMPUTE_TYPE"),
    )
    parser.add_argument(
        "--model-directory",
        default=os.environ.get("BASK_VOICE_MODEL_DIRECTORY"),
    )
    parser.add_argument(
        "--command-interpreter",
        choices=["none", "llama-cpp"],
        default=os.environ.get("BASK_VOICE_COMMAND_INTERPRETER", "none"),
    )
    parser.add_argument(
        "--command-model",
        default=os.environ.get("BASK_VOICE_COMMAND_MODEL"),
    )
    parser.add_argument(
        "--command-context-size",
        type=int,
        default=int(os.environ.get("BASK_VOICE_COMMAND_CONTEXT_SIZE", "4096")),
    )
    parser.add_argument(
        "--command-gpu-layers",
        type=int,
        default=int(os.environ.get("BASK_VOICE_COMMAND_GPU_LAYERS", "0")),
    )
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("Checkpoint 0 binds to loopback only.")
    if args.max_concurrent_requests <= 0:
        parser.error("--max-concurrent-requests must be positive.")
    if args.processing_timeout_seconds <= 0:
        parser.error("--processing-timeout-seconds must be positive.")

    profile = resolve_profile(
        args.profile,
        model=args.model,
        device=args.device,
        compute_type=args.compute_type,
    )
    model_directory = (
        Path(args.model_directory)
        if args.model_directory
        else default_model_directory()
    )
    transcriber = create_transcriber(
        args.transcriber,
        profile=profile,
        model_directory=model_directory,
    )
    interpreter = create_interpreter(
        args.command_interpreter,
        model_path=Path(args.command_model) if args.command_model else None,
        context_size=args.command_context_size,
        gpu_layers=args.command_gpu_layers,
    )
    profile_name = (
        "spike"
        if getattr(transcriber, "model_name", None) == "fixture"
        else profile.name
    )

    server = build_server(
        host=args.host,
        port=args.port,
        token=args.token,
        allowed_origins=parse_origins(args.allowed_origins),
        max_concurrent_requests=args.max_concurrent_requests,
        max_processing_seconds=args.processing_timeout_seconds,
        profile_name=profile_name,
        transcriber=transcriber,
        interpreter=interpreter,
    )
    print(f"Voice companion workbench: http://127.0.0.1:{args.port}/")
    print(f"Pairing token: {args.token}")
    print(
        "Transcription: "
        + VoiceCompanionHandler._service_status(
            getattr(server.transcriber, "state", "configuration_required")
        )
    )
    print(
        "Interpretation: "
        + getattr(server.interpreter, "state", "configuration_required")
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
