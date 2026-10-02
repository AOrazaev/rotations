from __future__ import annotations

import http.client
import json
import sys
import threading
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / "src"))

from voice_companion.server import build_server
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


if __name__ == "__main__":
    unittest.main()
