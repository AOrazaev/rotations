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
        boundary = "voice-boundary"
        context = {
            "protocolVersion": 1,
            "requestId": "request-1",
            "capturedSeconds": 12.3,
            "language": "en",
            "roster": [],
            "currentLineupIds": [],
            "allowedEventTypes": ["shot"],
        }
        body = (
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="context"\r\n'
            "Content-Type: application/json\r\n\r\n"
            f"{json.dumps(context)}\r\n"
            f"--{boundary}\r\n"
            'Content-Disposition: form-data; name="audio"; filename="sample.webm"\r\n'
            "Content-Type: audio/webm\r\n\r\n"
        ).encode() + b"audio-bytes" + f"\r\n--{boundary}--\r\n".encode()
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


if __name__ == "__main__":
    unittest.main()
