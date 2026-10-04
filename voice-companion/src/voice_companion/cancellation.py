from __future__ import annotations

import threading


class ProcessingCancelled(RuntimeError):
    def __init__(self, reason: str):
        super().__init__(
            "Processing timed out."
            if reason == "timeout"
            else "Processing was cancelled."
        )
        self.reason = reason


class CancellationSignal:
    def __init__(self):
        self._event = threading.Event()
        self._lock = threading.Lock()
        self._reason: str | None = None

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    @property
    def reason(self) -> str | None:
        with self._lock:
            return self._reason

    def cancel(self, reason: str = "cancelled") -> bool:
        with self._lock:
            if self._reason is not None:
                return False
            self._reason = reason
            self._event.set()
            return True

    def raise_if_cancelled(self):
        if self.cancelled:
            raise ProcessingCancelled(self.reason or "cancelled")
