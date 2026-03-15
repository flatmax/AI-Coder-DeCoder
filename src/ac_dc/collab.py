"""Collaboration — admission-gated multi-client WebSocket server.

When --collab is passed, CollabServer replaces JRPCServer and gates
non-first connections through an admission flow. The Collab class
exposes RPC methods for admission and client registry queries.
"""

import asyncio
import logging
import socket
import time
import uuid
from typing import Optional

logger = logging.getLogger(__name__)

# Admission timeout in seconds
_ADMISSION_TIMEOUT = 120


def _get_local_ips() -> set[str]:
    """Get all IP addresses assigned to local network interfaces."""
    ips = {"127.0.0.1", "::1"}
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            ips.add(info[4][0])
    except Exception:
        pass
    # Also try connecting to a public address to discover our LAN IP
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    return ips


class Collab:
    """RPC-exposed collaboration service.

    Manages the client registry and admission queue.
    Registered via add_class() as Collab.* RPC endpoints.
    """

    def __init__(self):
        self._clients: dict[str, dict] = {}  # client_id -> info
        self._pending: dict[str, dict] = {}  # client_id -> pending info
        self._local_ips: set[str] = _get_local_ips()
        self._server: Optional["CollabServer"] = None
        self._first_connection_done = False

    def _set_server(self, server: "CollabServer"):
        """Wire the server reference (called from CollabServer.__init__)."""
        self._server = server

    # ── Client Registry ───────────────────────────────────────────

    def _register_client(
        self,
        remote_uuid: str,
        ip: str,
        role: str = "participant",
        websocket=None,
        remote=None,
    ):
        """Register an admitted client."""
        is_localhost = ip in self._local_ips
        self._clients[remote_uuid] = {
            "client_id": remote_uuid,
            "ip": ip,
            "role": role,
            "is_localhost": is_localhost,
            "admitted_at": time.time(),
            "websocket": websocket,
            "remote": remote,
        }

    def _unregister_client(self, remote_uuid: str):
        """Remove a client and handle host promotion."""
        info = self._clients.pop(remote_uuid, None)
        if not info:
            return

        was_host = info.get("role") == "host"

        # Broadcast clientLeft
        if self._server:
            try:
                asyncio.ensure_future(self._broadcast_event("clientLeft", {
                    "client_id": remote_uuid,
                    "ip": info.get("ip", ""),
                    "role": info.get("role", ""),
                }))
            except Exception:
                pass

        # Host promotion
        if was_host and self._clients:
            # Promote the earliest-admitted client
            next_host_id = min(
                self._clients,
                key=lambda k: self._clients[k].get("admitted_at", 0),
            )
            self._clients[next_host_id]["role"] = "host"
            # Notify the promoted client
            remote = self._clients[next_host_id].get("remote")
            if remote:
                try:
                    asyncio.ensure_future(self._broadcast_event("roleChanged", {
                        "role": "host",
                        "reason": "previous host disconnected",
                    }))
                except Exception:
                    pass

        # If no clients remain, reset first-connection flag
        if not self._clients:
            self._first_connection_done = False

    def _is_caller_localhost(self) -> bool:
        """Check if the current RPC caller is from localhost."""
        if not self._server:
            return True  # No collab server = single-user mode
        caller_uuid = getattr(self._server, "_current_caller_uuid", None)
        if not caller_uuid:
            return True  # No tracking = assume localhost
        client = self._clients.get(caller_uuid)
        if not client:
            return True  # Unknown client = assume localhost
        return client.get("is_localhost", False)

    # ── Pending Queue ─────────────────────────────────────────────

    def _add_pending(self, client_id: str, ip: str, websocket) -> asyncio.Future:
        """Add a connection to the pending queue. Returns a future resolved on admit/deny."""
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        self._pending[client_id] = {
            "client_id": client_id,
            "ip": ip,
            "websocket": websocket,
            "future": future,
            "requested_at": time.time(),
        }

        # Auto-deny after timeout
        async def _timeout():
            await asyncio.sleep(_ADMISSION_TIMEOUT)
            if client_id in self._pending:
                self._resolve_pending(client_id, admitted=False, reason="Timed out")

        asyncio.ensure_future(_timeout())

        # Monitor pending client's WebSocket for early disconnect
        async def _monitor_disconnect():
            try:
                async for _ in websocket:
                    pass  # Consume messages until close
            except Exception:
                pass
            # Client disconnected while pending — clean up
            if client_id in self._pending:
                self._resolve_pending(client_id, admitted=False,
                                      reason="Client disconnected", replaced=False)

        asyncio.ensure_future(_monitor_disconnect())

        return future

    def _resolve_pending(self, client_id: str, admitted: bool,
                         reason: str = "", replaced: bool = False):
        """Resolve a pending request."""
        pending = self._pending.pop(client_id, None)
        if not pending:
            return
        future = pending.get("future")
        if future and not future.done():
            future.set_result(admitted)

        # Broadcast result
        asyncio.ensure_future(self._broadcast_event("admissionResult", {
            "client_id": client_id,
            "ip": pending.get("ip", ""),
            "admitted": admitted,
            "replaced": replaced,
        }))

    def _cancel_pending_from_ip(self, ip: str):
        """Cancel any existing pending request from the same IP."""
        to_cancel = [
            cid for cid, info in self._pending.items()
            if info.get("ip") == ip
        ]
        for cid in to_cancel:
            self._resolve_pending(cid, admitted=False, reason="Replaced by new connection",
                                  replaced=True)

    # ── RPC Methods ───────────────────────────────────────────────

    def admit_client(self, client_id: str) -> dict:
        """Admit a pending client. Callable by any admitted user."""
        if client_id not in self._pending:
            return {"error": f"No pending request for {client_id}"}
        self._resolve_pending(client_id, admitted=True)
        return {"ok": True, "client_id": client_id}

    def deny_client(self, client_id: str) -> dict:
        """Deny a pending client. Callable by any admitted user."""
        if client_id not in self._pending:
            return {"error": f"No pending request for {client_id}"}
        pending = self._pending.get(client_id)
        self._resolve_pending(client_id, admitted=False, reason="Denied")
        # Close the websocket
        if pending and pending.get("websocket"):
            asyncio.ensure_future(
                self._close_ws(pending["websocket"], 1008, "Denied")
            )
        return {"ok": True, "client_id": client_id}

    def get_connected_clients(self) -> list[dict]:
        """List all connected clients."""
        return [
            {
                "client_id": info["client_id"],
                "ip": info["ip"],
                "role": info["role"],
                "is_localhost": info["is_localhost"],
            }
            for info in self._clients.values()
        ]

    def get_collab_role(self) -> dict:
        """Get the calling client's own role."""
        if not self._server:
            return {"role": "host", "is_localhost": True, "client_id": ""}
        caller_uuid = getattr(self._server, "_current_caller_uuid", None)
        if not caller_uuid:
            return {"role": "host", "is_localhost": True, "client_id": ""}
        client = self._clients.get(caller_uuid)
        if not client:
            return {"role": "participant", "is_localhost": False, "client_id": ""}
        return {
            "role": client["role"],
            "is_localhost": client["is_localhost"],
            "client_id": client["client_id"],
        }

    # ── Helpers ────────────────────────────────────────────────────

    async def _broadcast_event(self, event_name: str, data: dict):
        """Broadcast an event to all admitted clients via self.call."""
        if not self._server:
            return
        try:
            call = self._server.call
            if call:
                await call[f"AcApp.{event_name}"](data)
        except Exception as e:
            logger.debug(f"Broadcast {event_name} failed: {e}")

    @staticmethod
    async def _close_ws(websocket, code: int, reason: str):
        """Close a websocket gracefully."""
        try:
            await websocket.close(code, reason)
        except Exception:
            pass


class CollabServer:
    """Admission-gated WebSocket server extending JRPCServer.

    Overrides handle_connection to insert admission screening for
    non-first connections. First connection is auto-admitted as host.

    This is a mixin-style class that wraps a JRPCServer instance
    rather than subclassing it, to avoid import-time dependency on
    jrpc-oo (which may not be installed in test environments).
    """

    def __init__(self, port: int, collab: Collab, remote_timeout: int = 120):
        from jrpc_oo import JRPCServer

        self._inner = JRPCServer(port=port, remote_timeout=remote_timeout)
        self._collab = collab
        self._collab._set_server(self)
        self._current_caller_uuid: Optional[str] = None
        self._port = port
        self._remote_timeout = remote_timeout

        # Override the inner server's handle_connection
        self._inner._original_handle_connection = self._inner.handle_connection
        self._inner.handle_connection = self._handle_connection

    # ── Delegation to inner JRPCServer ────────────────────────────

    @property
    def call(self):
        return self._inner.call

    def add_class(self, cls_instance, obj_name=None):
        self._inner.add_class(cls_instance, obj_name)

    async def start(self):
        await self._inner.start()

    async def stop(self):
        await self._inner.stop()

    # ── Connection Handling ───────────────────────────────────────

    async def _handle_connection(self, websocket):
        """Admission-gated connection handler."""
        import json

        peer_ip = websocket.remote_address[0] if hasattr(websocket, "remote_address") else "unknown"

        if not self._collab._first_connection_done:
            # First connection — auto-admit as host
            self._collab._first_connection_done = True
            await self._run_admitted_connection(websocket, peer_ip, role="host")
        else:
            # Subsequent connection — require admission
            client_id = str(uuid.uuid4())

            # Cancel any existing pending from same IP
            self._collab._cancel_pending_from_ip(peer_ip)

            # Send admission_pending to the new client
            try:
                await websocket.send(json.dumps({
                    "type": "admission_pending",
                    "client_id": client_id,
                }))
            except Exception:
                return

            # Broadcast admission request to all admitted clients
            await self._collab._broadcast_event("admissionRequest", {
                "client_id": client_id,
                "ip": peer_ip,
                "requested_at": time.time(),
            })

            # Monitor for client disconnect while pending
            future = self._collab._add_pending(client_id, peer_ip, websocket)

            # Wait for admission decision
            try:
                admitted = await future
            except asyncio.CancelledError:
                admitted = False

            if not admitted:
                try:
                    await websocket.send(json.dumps({
                        "type": "admission_denied",
                        "client_id": client_id,
                        "reason": "Denied",
                    }))
                except Exception:
                    pass
                try:
                    await websocket.close(1008, "Denied")
                except Exception:
                    pass
                return

            # Admitted — send confirmation
            try:
                await websocket.send(json.dumps({
                    "type": "admission_granted",
                    "client_id": client_id,
                }))
            except Exception:
                return

            await self._run_admitted_connection(websocket, peer_ip, role="participant")

    async def _run_admitted_connection(self, websocket, peer_ip: str, role: str):
        """Run the JRPC connection for an admitted client with caller tracking."""
        # Create JRPC remote via the inner server's method
        remote = self._inner.create_remote(websocket)
        remote_uuid = remote.uuid

        # Register in collab
        self._collab._register_client(
            remote_uuid, peer_ip, role=role,
            websocket=websocket, remote=remote,
        )

        # Broadcast clientJoined
        await self._collab._broadcast_event("clientJoined", {
            "client_id": remote_uuid,
            "ip": peer_ip,
            "role": role,
            "is_localhost": peer_ip in self._collab._local_ips,
        })

        try:
            # Run receive loop with caller tracking
            async for message in websocket:
                self._current_caller_uuid = remote_uuid
                data = message if isinstance(message, str) else message.decode()
                remote.receive(data)
        except Exception as e:
            logger.debug(f"Connection error for {peer_ip}: {e}")
        finally:
            self._current_caller_uuid = None
            self._collab._unregister_client(remote_uuid)