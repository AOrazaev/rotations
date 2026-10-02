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
from .config import (
    ALLOWED_AUDIO_TYPES,
    DEFAULT_ALLOWED_ORIGINS,
    PROTOCOL_VERSION,
    ServiceSettings,
)
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
    ):
        super().__init__(server_address, handler_class)
        self.settings = settings
        self.web_root = web_root
        self.transcriber = transcriber
        self.started_at = time.monotonic()
        self.processing_slots = threading.BoundedSemaphore(
            settings.max_concurrent_requests
        )
        self.processing_lock = threading.Lock()
        self.processing_requests = 0

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
            self._send_json(
                HTTPStatus.OK,
                {
                    "status": self._service_status(transcription_state),
                    "protocolVersion": PROTOCOL_VERSION,
                    "serviceVersion": __version__,
                    "profile": self.server.settings.profile,
                    "transcriptionReady": transcription_state == "ready",
                    "transcriptionState": transcription_state,
                    "commandModelReady": False,
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
                    "commandModel": None,
                    "eventInterpretation": False,
                    "security": {
                        "loopbackOnly": True,
                        "tokenRequired": True,
                        "originValidation": True,
                    },
                },
            )
            return
        self._serve_static(path)

    def do_POST(self):
        if urlparse(self.path).path != "/v1/voice-command":
            self._send_error(HTTPStatus.NOT_FOUND, "not_found", "Endpoint was not found.")
            return
        if not self._authorize_api():
            return

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
        try:
            transcription_started = time.perf_counter()
            transcription = self.server.transcriber.transcribe(
                audio, ALLOWED_AUDIO_TYPES[audio_type]
            )
            transcription_ms = round(
                (time.perf_counter() - transcription_started) * 1000
            )
        except TranscriptionUnavailable as error:
            self._send_error(
                HTTPStatus.SERVICE_UNAVAILABLE,
                "transcription_not_configured",
                str(error),
            )
            return
        except (RuntimeError, subprocess.TimeoutExpired) as error:
            self._send_error(
                HTTPStatus.INTERNAL_SERVER_ERROR,
                "transcription_failed",
                str(error),
            )
            return
        finally:
            self.server.end_processing()

        total_ms = round((time.perf_counter() - started) * 1000)
        self._send_json(
            HTTPStatus.OK,
            {
                "protocolVersion": PROTOCOL_VERSION,
                "requestId": context["requestId"],
                "transcript": transcription.text,
                "events": [],
                "overallConfidence": None,
                "warnings": [
                    "Command interpretation is not implemented in checkpoint 0."
                ],
                "processor": {
                    "transcriptionModel": transcription.model,
                    "commandModel": None,
                    "profile": self.server.settings.profile,
                },
                "timingMs": {
                    "transcription": transcription_ms,
                    "interpretation": 0,
                    "total": total_ms,
                },
            },
        )

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
        self, status: HTTPStatus, code: str, message: str
    ):
        self._send_json(
            status,
            {
                "error": {
                    "code": code,
                    "message": message,
                }
            },
        )

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
    max_concurrent_requests: int = 1,
    profile_name: str = "spike",
) -> VoiceCompanionServer:
    web_root = Path(__file__).resolve().parents[2] / "web"
    settings = ServiceSettings(
        token=token,
        allowed_origins=frozenset(allowed_origins),
        max_concurrent_requests=max_concurrent_requests,
        profile=profile_name,
    )
    return VoiceCompanionServer(
        (host, port),
        VoiceCompanionHandler,
        settings=settings,
        web_root=web_root,
        transcriber=transcriber
        or create_transcriber("external-command"),
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
    args = parser.parse_args()
    if args.host not in {"127.0.0.1", "::1", "localhost"}:
        parser.error("Checkpoint 0 binds to loopback only.")
    if args.max_concurrent_requests <= 0:
        parser.error("--max-concurrent-requests must be positive.")

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
        profile_name=profile_name,
        transcriber=transcriber,
    )
    print(f"Voice companion workbench: http://127.0.0.1:{args.port}/")
    print(f"Pairing token: {args.token}")
    print(
        "Transcription: "
        + VoiceCompanionHandler._service_status(
            getattr(server.transcriber, "state", "configuration_required")
        )
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
