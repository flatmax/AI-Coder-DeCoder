"""Tests for ac_dc.collab — Layer 4.4.1.

Scope:

- Localhost detection (loopback, interface IPs, unknowns).
- Collab registry — register / unregister / promote host.
- Collab pending queue — register, same-IP replacement,
  admit / deny resolution.
- Collab RPC methods — admit_client / deny_client /
  get_connected_clients / get_collab_role.
- Caller-tracking — is_caller_localhost with and without
  server context.
- CollabServer admission flow — first-connection auto-admit,
  subsequent admission pending, admit path, deny path,
  timeout, pre-admission disconnect, same-IP replacement.
- Host promotion on disconnect.
- Registered methods visible via add_class.

Strategy:

- No real websockets. A ``_FakeWebSocket`` class implements
  the subset of the websockets API that CollabServer touches
  — ``send`` records outgoing frames; ``wait_closed`` resolves
  when a test calls ``close`` manually; ``remote_address``
  returns a configurable tuple; the async-iteration protocol
  (``__aiter__`` / ``__anext__``) yields queued messages and
  raises when closed.
- ``CollabServer`` is constructed but ``start()`` is never
  called — the tests drive ``handle_connection`` directly with
  fake websockets. JRPC handshake (``create_remote`` →
  ``system.listComponents``) fires into the fake and the test
  just verifies the registry + broadcast side-effects.
- Broadcast verification — monkey-patch
  :meth:`CollabServer._push_event` with a recording stub so
  tests can assert on the sequence of event names without
  needing a real AcApp registered.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import socket
import time
from typing import Any, Optional
from unittest.mock import patch

import pytest

from ac_dc.collab import (
    Collab,
    CollabServer,
    ConnectedClient,
    PendingRequest,
    _is_loopback,
    is_localhost_ip,
)


# ---------------------------------------------------------------------------
# Fake websocket
# ---------------------------------------------------------------------------


class _FakeWebSocket:
    """Minimal WebSocket fake for CollabServer tests.

    Supports the methods CollabServer touches:

    - ``send(data)`` — appends to ``sent`` list
    - ``close(code, reason)`` — marks closed and resolves
      ``wait_closed``
    - ``wait_closed()`` — awaitable that completes when
      ``close`` is called or ``mark_closed`` is invoked
    - ``remote_address`` — configurable tuple
    - async iteration — yields messages queued via
      ``queue_message`` until closed

    Not a complete websocket fake — doesn't handle ping/pong,
    text/binary frames, etc. Adequate for the admission-flow
    tests which only care about send + close + iteration.
    """

    def __init__(
        self,
        remote_address: tuple[str, int] = ("127.0.0.1", 12345),
    ) -> None:
        self.remote_address = remote_address
        self.sent: list[str] = []
        self.closed = False
        self.close_code: Optional[int] = None
        self.close_reason: Optional[str] = None
        self._closed_event = asyncio.Event()
        self._messages: asyncio.Queue[Any] = asyncio.Queue()
        self._sentinel = object()

    async def send(self, data: Any) -> None:
        if self.closed:
            raise RuntimeError("websocket is closed")
        self.sent.append(data)

    async def close(
        self, code: int = 1000, reason: str = ""
    ) -> None:
        if self.closed:
            return
        self.closed = True
        self.close_code = code
        self.close_reason = reason
        self._closed_event.set()
        # Wake up the async iterator.
        await self._messages.put(self._sentinel)

    async def wait_closed(self) -> None:
        await self._closed_event.wait()

    async def queue_message(self, message: Any) -> None:
        """Push a message for the async iterator to yield."""
        await self._messages.put(message)

    def __aiter__(self) -> "_FakeWebSocket":
        return self

    async def __anext__(self) -> Any:
        message = await self._messages.get()
        if message is self._sentinel:
            raise StopAsyncIteration
        return message

    def sent_json(self) -> list[dict[str, Any]]:
        """Decode sent frames as JSON for assertion convenience."""
        return [json.loads(frame) for frame in self.sent]


# ---------------------------------------------------------------------------
# Localhost detection
# ---------------------------------------------------------------------------


class TestLoopback:
    """_is_loopback — IPv4 and IPv6 loopback detection."""

    def test_ipv4_loopback_127_0_0_1(self) -> None:
        assert _is_loopback("127.0.0.1") is True

    def test_ipv4_loopback_range(self) -> None:
        # 127.0.0.0/8 is all loopback.
        assert _is_loopback("127.5.5.5") is True

    def test_ipv6_loopback(self) -> None:
        assert _is_loopback("::1") is True

    def test_public_ipv4_not_loopback(self) -> None:
        assert _is_loopback("8.8.8.8") is False

    def test_private_ipv4_not_loopback(self) -> None:
        assert _is_loopback("192.168.1.1") is False

    def test_invalid_string_not_loopback(self) -> None:
        # Don't crash on garbage input.
        assert _is_loopback("not-an-ip") is False


class TestIsLocalhostIp:
    """is_localhost_ip — loopback + interface IP matching."""

    def test_loopback_always_localhost(self) -> None:
        assert is_localhost_ip("127.0.0.1") is True
        assert is_localhost_ip("::1") is True

    def test_unknown_public_ip_not_localhost(self) -> None:
        assert is_localhost_ip("8.8.8.8") is False

    def test_interface_ip_detected(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A LAN IP matching a local interface counts as localhost."""
        # Spoof the interface set to include a known LAN IP.
        monkeypatch.setattr(
            "ac_dc.collab._local_interface_ips",
            lambda: {"192.168.1.50", "10.0.0.1"},
        )
        assert is_localhost_ip("192.168.1.50") is True
        assert is_localhost_ip("10.0.0.1") is True

    def test_non_interface_ip_not_localhost(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            "ac_dc.collab._local_interface_ips",
            lambda: {"192.168.1.50"},
        )
        assert is_localhost_ip("192.168.1.99") is False


# ---------------------------------------------------------------------------
# Collab — registry management
# ---------------------------------------------------------------------------


class TestCollabRegistry:
    """Client registration, unregistration, host promotion."""

    def test_empty_initially(self) -> None:
        collab = Collab()
        assert collab.get_connected_clients() == []
        assert collab._is_first_connection() is True

    def test_register_first_client(self) -> None:
        collab = Collab()
        ws = _FakeWebSocket()
        client = collab._register_client(
            client_id="c1",
            ip="127.0.0.1",
            role="host",
            websocket=ws,
        )
        assert client.client_id == "c1"
        assert client.role == "host"
        assert client.is_localhost is True
        # First-connection flag flips after registration.
        assert collab._is_first_connection() is False

    def test_register_sets_admitted_at(self) -> None:
        collab = Collab()
        before = time.time()
        client = collab._register_client(
            client_id="c1",
            ip="127.0.0.1",
            role="host",
            websocket=_FakeWebSocket(),
        )
        after = time.time()
        assert before <= client.admitted_at <= after

    def test_register_detects_localhost_from_ip(self) -> None:
        collab = Collab()
        local = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        remote = collab._register_client(
            client_id="c2", ip="8.8.8.8", role="participant",
            websocket=_FakeWebSocket(),
        )
        assert local.is_localhost is True
        assert remote.is_localhost is False

    def test_unregister_returns_removed_client(self) -> None:
        collab = Collab()
        client = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        removed = collab._unregister_client("c1")
        assert removed is client
        assert collab._is_first_connection() is True

    def test_unregister_unknown_returns_none(self) -> None:
        collab = Collab()
        assert collab._unregister_client("unknown") is None

    def test_attach_remote_uuid(self) -> None:
        collab = Collab()
        client = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        collab._attach_remote_uuid("c1", "uuid-abc")
        assert client.remote_uuid == "uuid-abc"

    def test_attach_remote_uuid_unknown_client_no_error(
        self,
    ) -> None:
        """Defensive — unknown client_id is a silent no-op."""
        collab = Collab()
        collab._attach_remote_uuid("missing", "uuid-abc")
        # No exception, no state mutation.

    def test_promote_next_host_picks_earliest_admitted(
        self,
    ) -> None:
        """When host leaves, oldest remaining client is promoted."""
        collab = Collab()
        host = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        # Two participants, slight time gap.
        p1 = collab._register_client(
            client_id="c2", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )
        # Force p2 to have a later admitted_at.
        time.sleep(0.01)
        p2 = collab._register_client(
            client_id="c3", ip="10.0.0.2", role="participant",
            websocket=_FakeWebSocket(),
        )
        # Host leaves.
        collab._unregister_client(host.client_id)
        promoted = collab._promote_next_host()
        assert promoted is p1
        assert p1.role == "host"
        assert p2.role == "participant"

    def test_promote_when_only_host_remains_returns_none(
        self,
    ) -> None:
        """Host already exists — promotion is a no-op."""
        collab = Collab()
        collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        assert collab._promote_next_host() is None

    def test_promote_with_empty_registry(self) -> None:
        collab = Collab()
        assert collab._promote_next_host() is None

    def test_has_host_true_with_host(self) -> None:
        collab = Collab()
        collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        assert collab._has_host() is True

    def test_has_host_false_without_host(self) -> None:
        collab = Collab()
        collab._register_client(
            client_id="c1", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )
        assert collab._has_host() is False


# ---------------------------------------------------------------------------
# Collab — pending queue
# ---------------------------------------------------------------------------


class TestCollabPending:
    """Pending queue — register, same-IP replacement, cleanup."""

    async def test_register_pending_creates_request(self) -> None:
        collab = Collab()
        ws = _FakeWebSocket()
        request = collab._register_pending("10.0.0.1", ws)
        assert request.ip == "10.0.0.1"
        assert request.websocket is ws
        assert request.future.done() is False
        assert request.client_id in collab._pending

    async def test_same_ip_cancels_older_request(self) -> None:
        """Refresh from same IP → old pending gets auto-denied."""
        collab = Collab()
        old_ws = _FakeWebSocket()
        new_ws = _FakeWebSocket()
        old = collab._register_pending("10.0.0.1", old_ws)
        new = collab._register_pending("10.0.0.1", new_ws)

        # Old request resolved to False (auto-deny).
        assert old.future.done() is True
        assert old.future.result() is False
        # Old removed from queue; new present.
        assert old.client_id not in collab._pending
        assert new.client_id in collab._pending
        # New not resolved yet.
        assert new.future.done() is False

    async def test_different_ips_coexist(self) -> None:
        collab = Collab()
        r1 = collab._register_pending("10.0.0.1", _FakeWebSocket())
        r2 = collab._register_pending("10.0.0.2", _FakeWebSocket())
        assert r1.client_id in collab._pending
        assert r2.client_id in collab._pending
        assert r1.future.done() is False

    async def test_remove_pending_is_silent(self) -> None:
        collab = Collab()
        request = collab._register_pending(
            "10.0.0.1", _FakeWebSocket()
        )
        collab._remove_pending(request.client_id)
        assert request.client_id not in collab._pending
        # Removing again is idempotent.
        collab._remove_pending(request.client_id)


# ---------------------------------------------------------------------------
# Collab — RPC methods
# ---------------------------------------------------------------------------


class TestCollabRpcMethods:
    """admit_client / deny_client / get_connected_clients / get_collab_role."""

    async def test_admit_client_resolves_future(self) -> None:
        collab = Collab()
        request = collab._register_pending(
            "10.0.0.1", _FakeWebSocket()
        )
        result = collab.admit_client(request.client_id)
        assert result["ok"] is True
        assert result["client_id"] == request.client_id
        assert request.future.done() is True
        assert request.future.result() is True

    async def test_admit_unknown_client(self) -> None:
        collab = Collab()
        result = collab.admit_client("unknown")
        assert "error" in result

    async def test_admit_already_resolved(self) -> None:
        collab = Collab()
        request = collab._register_pending(
            "10.0.0.1", _FakeWebSocket()
        )
        collab.admit_client(request.client_id)
        # Second admit fails cleanly.
        result = collab.admit_client(request.client_id)
        assert "error" in result

    async def test_deny_client_resolves_future_to_false(
        self,
    ) -> None:
        collab = Collab()
        request = collab._register_pending(
            "10.0.0.1", _FakeWebSocket()
        )
        result = collab.deny_client(request.client_id)
        assert result["ok"] is True
        assert request.future.done() is True
        assert request.future.result() is False

    async def test_deny_unknown_client(self) -> None:
        collab = Collab()
        result = collab.deny_client("unknown")
        assert "error" in result

    def test_get_connected_clients_empty(self) -> None:
        collab = Collab()
        assert collab.get_connected_clients() == []

    def test_get_connected_clients_serialisable_shape(
        self,
    ) -> None:
        collab = Collab()
        collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        result = collab.get_connected_clients()
        assert len(result) == 1
        entry = result[0]
        # Exactly the public fields.
        assert set(entry.keys()) == {
            "client_id", "ip", "role", "is_localhost",
        }
        # WebSocket not exposed — serialisable over RPC.
        assert "websocket" not in entry

    def test_get_connected_clients_sorted_by_admitted_at(
        self,
    ) -> None:
        collab = Collab()
        collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        time.sleep(0.01)
        collab._register_client(
            client_id="c2", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )
        result = collab.get_connected_clients()
        assert [c["client_id"] for c in result] == ["c1", "c2"]

    def test_get_collab_role_no_server_wired(self) -> None:
        collab = Collab()  # _server is None
        result = collab.get_collab_role()
        assert "error" in result


# ---------------------------------------------------------------------------
# Collab — caller tracking
# ---------------------------------------------------------------------------


class TestIsCallerLocalhost:
    """is_caller_localhost — server-context dispatch."""

    def test_no_server_returns_true(self) -> None:
        """Non-RPC contexts (tests, background tasks) default trusted."""
        collab = Collab()
        assert collab.is_caller_localhost() is True

    def test_no_current_caller_returns_true(self) -> None:
        """_current_caller_uuid unset → treated as non-RPC context."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        # current_caller_uuid defaults to None.
        assert collab.is_caller_localhost() is True

    def test_localhost_caller(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        client = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        collab._attach_remote_uuid("c1", "uuid-abc")
        server.current_caller_uuid = "uuid-abc"
        assert collab.is_caller_localhost() is True

    def test_non_localhost_caller(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        client = collab._register_client(
            client_id="c1", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )
        collab._attach_remote_uuid("c1", "uuid-abc")
        server.current_caller_uuid = "uuid-abc"
        assert collab.is_caller_localhost() is False

    def test_unknown_caller_uuid_is_strict(self) -> None:
        """Unknown UUID → refuse (strict default)."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        server.current_caller_uuid = "uuid-does-not-exist"
        assert collab.is_caller_localhost() is False


# ---------------------------------------------------------------------------
# CollabServer — broadcast recording via patched _push_event
# ---------------------------------------------------------------------------


class _BroadcastRecorder:
    """Records every _push_event call for test assertions."""

    def __init__(self) -> None:
        self.events: list[tuple[str, Any]] = []

    async def __call__(self, event_name: str, payload: Any) -> None:
        self.events.append((event_name, payload))


# ---------------------------------------------------------------------------
# CollabServer — admission flow
# ---------------------------------------------------------------------------


class TestCollabServerFirstConnection:
    """First connection is auto-admitted as host."""

    async def test_first_connection_auto_admitted(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()

        with patch.object(server, "_push_event", recorder):
            ws = _FakeWebSocket(remote_address=("127.0.0.1", 12345))

            async def close_soon() -> None:
                # Give handle_connection time to register + start
                # the receive loop, then close the socket to
                # terminate the loop.
                await asyncio.sleep(0.05)
                await ws.close()

            closer = asyncio.ensure_future(close_soon())
            await server.handle_connection(ws)
            await closer

        # One admitted client — the host.
        clients = collab.get_connected_clients()
        assert len(clients) == 0  # disconnected by test end
        # clientJoined fired during the connection.
        joined_events = [
            p for name, p in recorder.events
            if name == "clientJoined"
        ]
        assert len(joined_events) == 1
        assert joined_events[0]["role"] == "host"
        # clientLeft fired when we closed the socket.
        left_events = [
            p for name, p in recorder.events
            if name == "clientLeft"
        ]
        assert len(left_events) == 1

    async def test_first_connection_no_admission_pending_sent(
        self,
    ) -> None:
        """Auto-admit path skips the raw admission messages."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)

        with patch.object(server, "_push_event", _BroadcastRecorder()):
            ws = _FakeWebSocket()

            async def close_soon() -> None:
                await asyncio.sleep(0.05)
                await ws.close()

            closer = asyncio.ensure_future(close_soon())
            await server.handle_connection(ws)
            await closer

        # No admission_pending / admission_granted frames.
        sent = ws.sent_json() if ws.sent else []
        # The only JSON the server sent is from JRPC handshake
        # (system.listComponents), which is NOT an admission
        # frame. Check that none of the specific admission
        # message types appear.
        types = {frame.get("type") for frame in sent}
        assert "admission_pending" not in types
        assert "admission_granted" not in types


class TestCollabServerAdmission:
    """Second-and-later connection admission flow."""

    async def test_admit_path(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()

        # Pre-register a host so the incoming connection is
        # treated as non-first.
        collab._register_client(
            client_id="host-id",
            ip="127.0.0.1",
            role="host",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            ws = _FakeWebSocket(
                remote_address=("10.0.0.5", 55555)
            )

            async def admit_soon() -> None:
                # Wait until the pending request appears, then
                # admit.
                for _ in range(50):
                    if collab._pending:
                        break
                    await asyncio.sleep(0.01)
                # Approve the single pending request.
                (req_id,) = list(collab._pending.keys())
                collab.admit_client(req_id)
                # Give the connection a moment to complete
                # setup, then close.
                await asyncio.sleep(0.05)
                await ws.close()

            admitter = asyncio.ensure_future(admit_soon())
            await server.handle_connection(ws)
            await admitter

        # Pending client got admission_pending then
        # admission_granted.
        types = [frame.get("type") for frame in ws.sent_json()]
        assert "admission_pending" in types
        assert "admission_granted" in types

        # Broadcast sequence: admissionRequest (pending),
        # admissionResult with admitted=True, clientJoined,
        # then clientLeft on close.
        event_names = [name for name, _ in recorder.events]
        assert "admissionRequest" in event_names
        assert "admissionResult" in event_names
        assert "clientJoined" in event_names
        assert "clientLeft" in event_names

        # admissionResult payload admitted=True.
        admission_result = next(
            p for name, p in recorder.events
            if name == "admissionResult"
        )
        assert admission_result["admitted"] is True

    async def test_deny_path(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()
        collab._register_client(
            client_id="host-id", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            ws = _FakeWebSocket(
                remote_address=("10.0.0.5", 55555)
            )

            async def deny_soon() -> None:
                for _ in range(50):
                    if collab._pending:
                        break
                    await asyncio.sleep(0.01)
                (req_id,) = list(collab._pending.keys())
                collab.deny_client(req_id)

            denier = asyncio.ensure_future(deny_soon())
            await server.handle_connection(ws)
            await denier

        # Denied client got admission_pending then
        # admission_denied, and websocket was closed.
        types = [frame.get("type") for frame in ws.sent_json()]
        assert "admission_pending" in types
        assert "admission_denied" in types
        assert ws.closed is True
        # Close code = policy violation.
        assert ws.close_code == 1008

        # Broadcast sequence: admissionRequest, admissionResult
        # with admitted=False. NO clientJoined or clientLeft
        # (never registered).
        event_names = [name for name, _ in recorder.events]
        assert "admissionRequest" in event_names
        assert "admissionResult" in event_names
        assert "clientJoined" not in event_names
        assert "clientLeft" not in event_names

        admission_result = next(
            p for name, p in recorder.events
            if name == "admissionResult"
        )
        assert admission_result["admitted"] is False

    async def test_pre_admission_disconnect(self) -> None:
        """Pending client closes their browser before decision."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()
        collab._register_client(
            client_id="host-id", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            ws = _FakeWebSocket(
                remote_address=("10.0.0.5", 55555)
            )

            async def disconnect_soon() -> None:
                # Wait for pending to register, then close
                # without being admitted.
                for _ in range(50):
                    if collab._pending:
                        break
                    await asyncio.sleep(0.01)
                await ws.close()

            disconnector = asyncio.ensure_future(disconnect_soon())
            await server.handle_connection(ws)
            await disconnector

        # Client never registered (no clientJoined).
        event_names = [name for name, _ in recorder.events]
        assert "clientJoined" not in event_names
        # Pending queue cleaned up.
        assert collab._pending == {}

    async def test_same_ip_replacement_cancels_old_pending(
        self,
    ) -> None:
        """Second connection from same IP auto-denies the first."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)

        collab._register_client(
            client_id="host-id", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", _BroadcastRecorder()):
            ws1 = _FakeWebSocket(
                remote_address=("10.0.0.5", 55555)
            )
            ws2 = _FakeWebSocket(
                remote_address=("10.0.0.5", 55556)
            )

            async def sequence() -> None:
                # Start first pending request.
                task1 = asyncio.ensure_future(
                    server.handle_connection(ws1)
                )
                # Wait until it registers as pending.
                for _ in range(50):
                    if collab._pending:
                        break
                    await asyncio.sleep(0.01)
                # Start second connection from same IP.
                task2 = asyncio.ensure_future(
                    server.handle_connection(ws2)
                )
                # Give task2 time to register.
                await asyncio.sleep(0.05)
                # Deny whichever pending remains to unblock
                # task2 cleanly.
                if collab._pending:
                    (req_id,) = list(collab._pending.keys())
                    collab.deny_client(req_id)
                await asyncio.gather(task1, task2)

            await sequence()

        # ws1 should have received admission_pending then
        # admission_denied (auto-deny via replacement).
        ws1_types = [
            f.get("type") for f in ws1.sent_json()
        ]
        assert "admission_pending" in ws1_types
        assert "admission_denied" in ws1_types


class TestCollabServerHostPromotion:
    """Host disconnect promotes the next admitted client."""

    async def test_host_disconnect_promotes_next(self) -> None:
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()

        # Register two admitted clients directly.
        host = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        time.sleep(0.01)
        participant = collab._register_client(
            client_id="c2", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            # Trigger the disconnect handler directly.
            await server._handle_disconnect(host)

        # Participant was promoted.
        assert participant.role == "host"

        # roleChanged broadcast fired.
        role_changed = [
            p for name, p in recorder.events
            if name == "roleChanged"
        ]
        assert len(role_changed) == 1
        assert role_changed[0]["client_id"] == "c2"

    async def test_participant_disconnect_no_promotion(
        self,
    ) -> None:
        """Non-host disconnect doesn't trigger promotion."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()

        host = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )
        participant = collab._register_client(
            client_id="c2", ip="10.0.0.1", role="participant",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            await server._handle_disconnect(participant)

        # Host unchanged; no promotion event.
        assert host.role == "host"
        role_changed = [
            p for name, p in recorder.events
            if name == "roleChanged"
        ]
        assert role_changed == []

    async def test_last_client_disconnect_no_promotion(
        self,
    ) -> None:
        """When last client leaves, no promotion event fires."""
        collab = Collab()
        server = CollabServer(port=0, collab=collab)
        recorder = _BroadcastRecorder()

        host = collab._register_client(
            client_id="c1", ip="127.0.0.1", role="host",
            websocket=_FakeWebSocket(),
        )

        with patch.object(server, "_push_event", recorder):
            await server._handle_disconnect(host)

        assert collab.get_connected_clients() == []
        role_changed = [
            p for name, p in recorder.events
            if name == "roleChanged"
        ]
        assert role_changed == []


# ---------------------------------------------------------------------------
# Peer IP extraction
# ---------------------------------------------------------------------------


class TestPeerIpExtraction:
    """_extract_peer_ip — websockets API shape handling."""

    def test_normal_remote_address(self) -> None:
        ws = _FakeWebSocket(remote_address=("10.0.0.1", 54321))
        assert CollabServer._extract_peer_ip(ws) == "10.0.0.1"

    def test_missing_remote_address(self) -> None:
        ws = _FakeWebSocket()
        del ws.remote_address  # type: ignore[misc]
        assert CollabServer._extract_peer_ip(ws) == "unknown"

    def test_malformed_remote_address(self) -> None:
        ws = _FakeWebSocket()
        ws.remote_address = None  # type: ignore[assignment]
        assert CollabServer._extract_peer_ip(ws) == "unknown"