from __future__ import annotations

import http.client
import json
import sys
import threading
import time
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.server import build_server
from voice_companion.interpretation import (
    InterpretationResult,
    InvalidInterpretation,
)
from voice_companion.transcription import (
    TranscriptionResult,
)


class FixtureTranscriber:
    ready = True
    model_name = "fixture"

    def transcribe(self, audio: bytes, suffix: str):
        if not audio:
            raise RuntimeError("missing audio")
        return TranscriptionResult(
            text="Seven assist and thirteen makes two in transition",
            model="fixture",
        )


class FixtureInterpreter:
    ready = True
    state = "ready"
    model_name = "fixture-command-model"

    def metadata(self):
        return {
            "runtime": "fixture",
            "model": self.model_name,
            "modelPath": None,
            "lastError": None,
        }

    def interpret(self, transcript, context, cancellation=None):
        if cancellation:
            cancellation.raise_if_cancelled()
        return InterpretationResult(
            events=[
                {
                    "side": "team",
                    "type": "shot",
                    "playerId": "p13",
                    "shotValue": 2,
                    "made": True,
                    "confidence": 0.95,
                }
            ],
            overall_confidence=0.95,
            warnings=[],
            model=self.model_name,
        )


class FailingInterpreter(FixtureInterpreter):
    def interpret(self, transcript, context, cancellation=None):
        raise InvalidInterpretation("Model proposal is invalid.")


class BlockingInterpreter(FixtureInterpreter):
    def __init__(self):
        self.entered = threading.Event()

    def interpret(self, transcript, context, cancellation=None):
        self.entered.set()
        while True:
            if cancellation:
                cancellation.raise_if_cancelled()
            time.sleep(0.01)


class OutOfMemoryInterpreter(FixtureInterpreter):
    def interpret(self, transcript, context, cancellation=None):
        raise MemoryError("allocation failed")


class CrashOnceInterpreter(FixtureInterpreter):
    def __init__(self):
        self.calls = 0

    def interpret(self, transcript, context, cancellation=None):
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("model worker crashed")
        return super().interpret(transcript, context, cancellation)


class ServerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = build_server(
            host="127.0.0.1",
            port=0,
            token="test-token",
            allowed_origins={"https://aorazaev.github.io"},
            transcriber=FixtureTranscriber(),
        )
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.port = cls.server.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join(timeout=2)

    def request(self, method, path, *, headers=None, body=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.port, timeout=2)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        payload = response.read()
        connection.close()
        return response.status, response.getheaders(), payload

    def voice_body(self, context, audio=b"audio-bytes"):
        boundary = "voice-boundary"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="context"\r\n'
            "Content-Type: application/json\r\n\r\n"
            f"{json.dumps(context)}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="audio"; filename="sample.webm"\r\n'
            "Content-Type: audio/webm\r\n\r\n"
        ).encode() + audio + f"\r\n--{boundary}--\r\n".encode()
        return boundary, body

    def test_health_requires_token(self):
        status, _, payload = self.request("GET", "/v1/health")
        self.assertEqual(status, 401)
        self.assertEqual(json.loads(payload)["error"]["code"], "unauthorized")

    def test_health_reports_capabilities(self):
        status, _, payload = self.request(
            "GET",
            "/v1/health",
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
            },
        )
        self.assertEqual(status, 200)
        self.assertTrue(json.loads(payload)["transcriptionReady"])
        self.assertEqual(
            json.loads(payload)["commandModelState"],
            "configuration_required",
        )

    def test_diagnostics_are_redacted(self):
        status, _, payload = self.request(
            "GET",
            "/v1/diagnostics",
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
            },
        )
        self.assertEqual(status, 200)
        diagnostics = json.loads(payload)
        encoded = json.dumps(diagnostics)
        self.assertNotIn("test-token", encoded)
        self.assertNotIn("modelPath", diagnostics["interpretation"])
        self.assertNotIn("modelDirectory", diagnostics["transcription"])
        self.assertTrue(diagnostics["privacy"]["containsToken"] is False)

    def test_unknown_origin_is_rejected(self):
        status, _, payload = self.request(
            "GET",
            "/v1/health",
            headers={
                "Origin": "https://attacker.example",
                "X-Bask-Voice-Token": "test-token",
            },
        )
        self.assertEqual(status, 403)
        self.assertEqual(json.loads(payload)["error"]["code"], "origin_not_allowed")

    def test_private_network_preflight_is_explicit(self):
        status, headers, _ = self.request(
            "OPTIONS",
            "/v1/voice-command",
            headers={
                "Origin": "https://aorazaev.github.io",
                "Access-Control-Request-Private-Network": "true",
            },
        )
        self.assertEqual(status, 204)
        self.assertIn(
            ("Access-Control-Allow-Private-Network", "true"),
            headers,
        )

    def test_voice_command_returns_transcript_without_events(self):
        context = {
            "protocolVersion": 1,
            "requestId": "request-1",
            "capturedSeconds": 12.3,
            "language": "en",
            "roster": [],
            "currentLineupIds": [],
            "allowedEventTypes": ["shot"],
        }
        boundary, body = self.voice_body(context)
        status, _, payload = self.request(
            "POST",
            "/v1/voice-command",
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(body)),
            },
            body=body,
        )
        self.assertEqual(status, 200)
        result = json.loads(payload)
        self.assertEqual(result["requestId"], "request-1")
        self.assertEqual(result["events"], [])
        self.assertIn("Seven assist", result["transcript"])

    def test_voice_command_rejects_unknown_context_fields(self):
        context = {
            "protocolVersion": 1,
            "requestId": "request-1",
            "capturedSeconds": 12.3,
            "language": "en",
            "roster": [],
            "currentLineupIds": [],
            "allowedEventTypes": ["shot"],
            "game": {"events": []},
        }
        boundary, body = self.voice_body(context)
        status, _, payload = self.request(
            "POST",
            "/v1/voice-command",
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(body)),
            },
            body=body,
        )
        self.assertEqual(status, 400)
        error = json.loads(payload)["error"]
        self.assertEqual(error["code"], "invalid_request")
        self.assertIn("unsupported fields: game", error["message"])

    def test_processing_slots_are_bounded(self):
        self.assertTrue(self.server.begin_processing())
        try:
            self.assertFalse(self.server.begin_processing())
        finally:
            self.server.end_processing()
        self.assertTrue(self.server.begin_processing())
        self.server.end_processing()

    def test_interpret_command_requires_configured_interpreter(self):
        context = {
            "protocolVersion": 1,
            "requestId": "request-1",
            "capturedSeconds": 12.3,
            "language": "en",
            "roster": [],
            "currentLineupIds": [],
            "allowedEventTypes": ["shot"],
        }
        body = json.dumps(
            {"transcript": "Thirteen makes two", "context": context}
        ).encode()
        status, _, payload = self.request(
            "POST",
            "/v1/interpret-command",
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
            body=body,
        )
        self.assertEqual(status, 503)
        self.assertEqual(
            json.loads(payload)["error"]["code"],
            "interpretation_not_configured",
        )


class InterpretationServerTest(unittest.TestCase):
    def setUp(self):
        self.server = build_server(
            host="127.0.0.1",
            port=0,
            token="test-token",
            allowed_origins={"https://aorazaev.github.io"},
            transcriber=FixtureTranscriber(),
            interpreter=FixtureInterpreter(),
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever,
            daemon=True,
        )
        self.thread.start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)

    def test_interpret_command_returns_structured_proposal(self):
        context = {
            "protocolVersion": 1,
            "requestId": "request-2",
            "capturedSeconds": 15.0,
            "language": "en",
            "roster": [
                {"id": "p13", "jersey": "13", "name": "Denis"},
            ],
            "currentLineupIds": ["p13"],
            "allowedEventTypes": ["shot"],
        }
        body = json.dumps(
            {"transcript": "Thirteen makes two", "context": context}
        ).encode()
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=2,
        )
        connection.request(
            "POST",
            "/v1/interpret-command",
            body=body,
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()

        self.assertEqual(response.status, 200)
        self.assertEqual(payload["events"][0]["playerId"], "p13")
        self.assertIsNone(payload["processor"]["transcriptionModel"])
        self.assertEqual(
            payload["processor"]["commandModel"],
            "fixture-command-model",
        )

    def test_warmup_reports_models_hardware_and_timing(self):
        body = b"{}"
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=2,
        )
        connection.request(
            "POST",
            "/v1/warmup",
            body=body,
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()

        self.assertEqual(response.status, 200)
        self.assertEqual(payload["status"], "ready")
        self.assertIn("recommendedProfile", payload["hardware"])
        self.assertGreaterEqual(payload["timingMs"]["total"], 0)

    def test_active_interpretation_can_be_cancelled(self):
        interpreter = BlockingInterpreter()
        self.server.interpreter = interpreter
        context = {
            "protocolVersion": 1,
            "requestId": "request-cancel",
            "capturedSeconds": 15.0,
            "language": "en",
            "roster": [
                {"id": "p13", "jersey": "13", "name": "Denis"},
            ],
            "currentLineupIds": ["p13"],
            "allowedEventTypes": ["shot"],
        }
        body = json.dumps(
            {"transcript": "Thirteen makes two", "context": context}
        ).encode()
        result = {}

        def send_interpretation():
            connection = http.client.HTTPConnection(
                "127.0.0.1",
                self.server.server_address[1],
                timeout=3,
            )
            connection.request(
                "POST",
                "/v1/interpret-command",
                body=body,
                headers={
                    "Origin": "https://aorazaev.github.io",
                    "X-Bask-Voice-Token": "test-token",
                    "Content-Type": "application/json",
                    "Content-Length": str(len(body)),
                },
            )
            response = connection.getresponse()
            result["status"] = response.status
            result["payload"] = json.loads(response.read())
            connection.close()

        request_thread = threading.Thread(target=send_interpretation)
        request_thread.start()
        self.assertTrue(interpreter.entered.wait(timeout=1))

        cancel_body = json.dumps({"requestId": "request-cancel"}).encode()
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=2,
        )
        connection.request(
            "POST",
            "/v1/cancel",
            body=cancel_body,
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": "application/json",
                "Content-Length": str(len(cancel_body)),
            },
        )
        cancel_response = connection.getresponse()
        cancel_payload = json.loads(cancel_response.read())
        connection.close()
        request_thread.join(timeout=2)

        self.assertEqual(cancel_response.status, 202)
        self.assertEqual(cancel_payload["status"], "cancellation_requested")
        self.assertEqual(result["status"], 409)
        self.assertEqual(result["payload"]["error"]["code"], "request_cancelled")

    def test_out_of_memory_is_explicit(self):
        self.server.interpreter = OutOfMemoryInterpreter()
        status, payload = self._interpret_request("request-oom")

        self.assertEqual(status, 507)
        self.assertEqual(payload["error"]["code"], "model_out_of_memory")

    def test_service_recovers_after_interpreter_runtime_failure(self):
        self.server.interpreter = CrashOnceInterpreter()

        first_status, first_payload = self._interpret_request("request-crash-1")
        second_status, second_payload = self._interpret_request("request-crash-2")

        self.assertEqual(first_status, 500)
        self.assertEqual(first_payload["error"]["code"], "interpretation_failed")
        self.assertEqual(second_status, 200)
        self.assertEqual(second_payload["events"][0]["type"], "shot")

    def _interpret_request(self, request_id):
        context = {
            "protocolVersion": 1,
            "requestId": request_id,
            "capturedSeconds": 15.0,
            "language": "en",
            "roster": [
                {"id": "p13", "jersey": "13", "name": "Denis"},
            ],
            "currentLineupIds": ["p13"],
            "allowedEventTypes": ["shot"],
        }
        body = json.dumps(
            {"transcript": "Thirteen makes two", "context": context}
        ).encode()
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=2,
        )
        connection.request(
            "POST",
            "/v1/interpret-command",
            body=body,
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": "application/json",
                "Content-Length": str(len(body)),
            },
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()
        return response.status, payload

    def test_voice_error_preserves_successful_transcript(self):
        self.server.interpreter = FailingInterpreter()
        context = {
            "protocolVersion": 1,
            "requestId": "request-partial",
            "capturedSeconds": 15.0,
            "language": "en",
            "roster": [],
            "currentLineupIds": [],
            "allowedEventTypes": ["shot"],
        }
        boundary = "voice-boundary"
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="context"\r\n'
            "Content-Type: application/json\r\n\r\n"
            f"{json.dumps(context)}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="audio"; filename="sample.webm"\r\n'
            "Content-Type: audio/webm\r\n\r\n"
        ).encode() + b"audio" + f"\r\n--{boundary}--\r\n".encode()
        connection = http.client.HTTPConnection(
            "127.0.0.1",
            self.server.server_address[1],
            timeout=2,
        )
        connection.request(
            "POST",
            "/v1/voice-command",
            body=body,
            headers={
                "Origin": "https://aorazaev.github.io",
                "X-Bask-Voice-Token": "test-token",
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Content-Length": str(len(body)),
            },
        )
        response = connection.getresponse()
        payload = json.loads(response.read())
        connection.close()

        self.assertEqual(response.status, 500)
        self.assertEqual(payload["error"]["stage"], "interpretation")
        self.assertIn("Seven assist", payload["partialResult"]["transcript"])
        self.assertEqual(
            payload["partialResult"]["processor"]["transcriptionModel"],
            "fixture",
        )


if __name__ == "__main__":
    unittest.main()
