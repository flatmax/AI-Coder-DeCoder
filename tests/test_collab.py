"""Tests for Collab — client registry, admission, localhost detection."""

import asyncio
import time
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from ac_dc.collab import Collab, _get_local_ips


# ── Localhost Detection ───────────────────────────────────────────

class TestLocalhostDetection:
    def test_loopback_ipv4(self):
        collab = Collab()
        assert "127.0.0.1" in collab._local_ips

    def test_loopback_ipv6(self):
        collab = Collab()
        assert "::1" in collab._local_ips

    def test_get_local_ips_returns_set(self):
        ips = _get_local_ips()
        assert isinstance(ips, set)
        assert "127.0.0.1" in ips


# ── Client Registry ──────────────────────────────────────────────

class TestClientRegistry:
    def test_register_client(self):
        collab = Collab()
        collab._register_client("uuid-1", "127.0.0.1", role="host")
        clients = collab.get_connected_clients()
        assert len(clients) == 1
        assert clients[0]["client_id"] == "uuid-1"
        assert clients[0]["role"] == "host"
        assert clients[0]["is_localhost"] is True

    def test_register_non_localhost(self):
        collab = Collab()
        collab._register_client("uuid-1", "192.168.1.42", role="participant")
        clients = collab.get_connected_clients()
        assert clients[0]["is_localhost"] is False

    def test_unregister_client(self):
        collab = Collab()
        collab._register_client("uuid-1", "127.0.0.1", role="host")
        collab._unregister_client("uuid-1")
        assert collab.get_connected_clients() == []

    def test_host_promotion_on_disconnect(self):
        collab = Collab()
        collab._register_client("uuid-1", "127.0.0.1", role="host")
        time.sleep(0.01)
        collab._register_client("uuid-2", "127.0.0.1", role="participant")
        collab._unregister_client("uuid-1")
        clients = collab.get_connected_clients()
        assert len(clients) == 1
        assert clients[0]["role"] == "host"
        assert clients[0]["client_id"] == "uuid-2"

    def test_last_disconnect_resets_first_flag(self):
        collab = Collab()
        collab._first_connection_done = True
        collab._register_client("uuid-1", "127.0.0.1", role="host")
        collab._unregister_client("uuid-1")
        assert collab._first_connection_done is False

    def test_unregister_nonexistent(self):
        collab = Collab()
        collab._unregister_client("nonexistent")  # Should not raise


# ── Caller Identification ─────────────────────────────────────────

class TestCallerIdentification:
    def test_no_server_is_localhost(self):
        collab = Collab()
        assert collab._is_caller_localhost() is True

    def test_localhost_caller(self):
        collab = Collab()
        server = MagicMock()
        server._current_caller_uuid = "uuid-1"
        collab._server = server
        collab._register_client("uuid-1", "127.0.0.1", role="host")
        assert collab._is_caller_localhost() is True

    def test_non_localhost_caller(self):
        collab = Collab()
        server = MagicMock()
        server._current_caller_uuid = "uuid-2"
        collab._server = server
        collab._register_client("uuid-2", "192.168.1.42", role="participant")
        assert collab._is_caller_localhost() is False

    def test_unknown_caller(self):
        collab = Collab()
        server = MagicMock()
        server._current_caller_uuid = "unknown-uuid"
        collab._server = server
        # No client registered for this UUID
        assert collab._is_caller_localhost() is True


# ── RPC Methods ───────────────────────────────────────────────────

class TestRPCMethods:
    def test_get_collab_role_no_server(self):
        collab = Collab()
        role = collab.get_collab_role()
        assert role["role"] == "host"
        assert role["is_localhost"] is True

    def test_get_collab_role_with_client(self):
        collab = Collab()
        server = MagicMock()
        server._current_caller_uuid = "uuid-1"
        collab._server = server
        collab._register_client("uuid-1", "192.168.1.42", role="participant")
        role = collab.get_collab_role()
        assert role["role"] == "participant"
        assert role["is_localhost"] is False

    def test_admit_nonexistent(self):
        collab = Collab()
        result = collab.admit_client("nonexistent")
        assert "error" in result

    def test_deny_nonexistent(self):
        collab = Collab()
        result = collab.deny_client("nonexistent")
        assert "error" in result


# ── Pending Queue ─────────────────────────────────────────────────

class TestPendingQueue:
    @pytest.mark.asyncio
    async def test_add_and_resolve_pending(self):
        collab = Collab()
        ws = AsyncMock()
        future = collab._add_pending("client-1", "192.168.1.42", ws)
        assert "client-1" in collab._pending
        collab._resolve_pending("client-1", admitted=True)
        assert "client-1" not in collab._pending
        result = await asyncio.wait_for(future, timeout=1.0)
        assert result is True

    @pytest.mark.asyncio
    async def test_deny_pending(self):
        collab = Collab()
        ws = AsyncMock()
        future = collab._add_pending("client-1", "192.168.1.42", ws)
        collab._resolve_pending("client-1", admitted=False)
        result = await asyncio.wait_for(future, timeout=1.0)
        assert result is False

    @pytest.mark.asyncio
    async def test_cancel_pending_from_same_ip(self):
        collab = Collab()
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        future1 = collab._add_pending("client-1", "192.168.1.42", ws1)
        collab._cancel_pending_from_ip("192.168.1.42")
        assert "client-1" not in collab._pending
        result = await asyncio.wait_for(future1, timeout=1.0)
        assert result is False

    def test_resolve_nonexistent(self):
        collab = Collab()
        collab._resolve_pending("nonexistent", admitted=True)  # Should not raise


# ── Integration ───────────────────────────────────────────────────

class TestCollabIntegration:
    def test_full_lifecycle(self):
        """First connection → register → second pending → admit → disconnect."""
        collab = Collab()

        # First connection auto-admitted
        assert not collab._first_connection_done
        collab._first_connection_done = True
        collab._register_client("host-1", "127.0.0.1", role="host")
        assert len(collab.get_connected_clients()) == 1

        # Second client registered
        collab._register_client("client-2", "192.168.1.42", role="participant")
        assert len(collab.get_connected_clients()) == 2

        # Host disconnects → participant promoted
        collab._unregister_client("host-1")
        clients = collab.get_connected_clients()
        assert len(clients) == 1
        assert clients[0]["role"] == "host"

        # Last client disconnects → reset
        collab._unregister_client("client-2")
        assert collab._first_connection_done is False

    def test_multiple_localhost_clients(self):
        """Multiple localhost connections all get is_localhost=True."""
        collab = Collab()
        collab._register_client("a", "127.0.0.1", role="host")
        collab._register_client("b", "127.0.0.1", role="participant")
        for c in collab.get_connected_clients():
            assert c["is_localhost"] is True