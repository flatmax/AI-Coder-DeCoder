"""Collaboration mode — multi-browser connection with admission screening.

CollabServer extends JRPCServer to gate non-first connections behind
an admission flow. The Collab service class exposes RPC endpoints for
admission management and client registry queries.

Architecture:
- CollabServer overrides handle_connection to insert admission logic
- Collab is a separate class registered via add_class() so only its
  public methods become RPC endpoints (avoids exposing inherited server
  methods like start, stop, handle_connection)
- Client registry is shared between CollabServer and Collab
"""

import asyncio
import logging
import socket
import time
import uuid

from jrpc_oo import JRPCServer

logger = logging.getLogger(__name__)


def _get_local_ips():
    """Get all IP addresses assigned to local network interfaces."""
    local_ips = {"127.0.0.1", "::1"}
    try:
        # Get hostname-based IPs
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            local_ips.add(info[4][0])
    except Exception:
        pass
    try:
        # Get IPs via UDP trick (doesn't actually send anything)
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            local_ips.add(s.getsockname()[0])
    except Exception:
        pass
    return local_ips


def _is_localhost(ip, local_ips=None):
    """Check if an IP address is localhost or a local interface."""
    if ip in ("127.0.0.1", "::1", "localhost"):
        return True
    if local_ips is None:
        local_ips = _get_local_ips()
    return ip in local_ips


class Collab:
    """RPC service class for collaboration endpoints.

    Registered via server.add_class(collab, 'Collab') so public methods
    become Collab.* RPC endpoints. Holds shared state with CollabServer.
    """

    def __init__(self):
        self._server = None  # Set by CollabServer after construction
        self._clients = {}  # uuid -> client_info dict
        self._pending = {}  # client_id -> pending_info dict
        self._local_ips = _get_local_ips()
        self._admission_order = []  # list of uuids in admission order

    def _get_caller_info(self):
        """Get the client info for the current RPC caller."""
        if not self._server:
            return None
        caller_uuid = getattr(self._server, '_current_caller_uuid', None)
        if not caller_uuid:
            return None
        return self._clients.get(caller_uuid)

    def _is_caller_localhost(self):
        """Check if the current RPC caller is from localhost."""
        info = self._get_caller_info()
        if info is None:
            # No caller tracking — assume localhost (single-user fallback)
            return True
        return info.get("is_localhost", False)

    def _register_client(self, remote_uuid, ip, role="participant", websocket=None, remote=None):
        """Register an admitted client."""
        client_id = str(uuid.uuid4())
        is_local = _is_localhost(ip, self._local_ips)
        self._clients[remote_uuid] = {
            "client_id": client_id,
            "remote_uuid": remote_uuid,
            "ip": ip,
            "role": role,
            "is_localhost": is_local,
            "admitted_at": time.time(),
            "websocket": websocket,
            "remote": remote,
        }
        self._admission_order.append(remote_uuid)
        logger.info(
            f"Client registered: {client_id} ({ip}, role={role}, "
            f"localhost={is_local})"
        )
        return client_id

    def _unregister_client(self, remote_uuid):
        """Remove a client from the registry. Handle host promotion."""
        info = self._clients.pop(remote_uuid, None)
        if remote_uuid in self._admission_order:
            self._admission_order.remove(remote_uuid)
        if not info:
            return

        client_id = info["client_id"]
        was_host = info["role"] == "host"
        logger.info(f"Client unregistered: {client_id} ({info['ip']})")

        # Broadcast clientLeft to remaining clients
        self._broadcast_event("clientLeft", {
            "client_id": client_id,
            "ip": info["ip"],
            "role": info["role"],
        })

        # Host promotion if the host left
        if was_host and self._clients:
            # Promote next client by admission order
            for ruuid in self._admission_order:
                if ruuid in self._clients:
                    self._clients[ruuid]["role"] = "host"
                    new_host = self._clients[ruuid]
                    logger.info(
                        f"Host promoted: {new_host['client_id']} ({new_host['ip']})"
                    )
                    # Notify the promoted client
                    self._send_to_client(ruuid, "roleChanged", {
                        "role": "host",
                        "reason": "previous host disconnected",
                    })
                    # Broadcast updated client list
                    self._broadcast_event("clientJoined", {
                        "client_id": new_host["client_id"],
                        "ip": new_host["ip"],
                        "role": "host",
                        "is_localhost": new_host["is_localhost"],
                    })
                    break

    def _broadcast_event(self, event_name, data):
        """Broadcast an event to all admitted clients via the server's call proxy.

        Uses self._server.call['AcApp.method'](data) — the standard jrpc-oo
        server call pattern that sends to all connected remotes.
        """
        if not self._server:
            return
        call = getattr(self._server, 'call', None)
        if not call:
            return
        method = f"AcApp.{event_name}"
        try:
            result = call[method](data)
            if asyncio.isfuture(result) or asyncio.iscoroutine(result):
                asyncio.ensure_future(result)
        except Exception as e:
            logger.debug(f"Broadcast {event_name} failed: {e}")

    def _send_to_client(self, remote_uuid, event_name, data):
        """Send an event to a specific client via the server's call proxy.

        Note: jrpc-oo server.call broadcasts to ALL remotes. For targeted
        sends we use remote.call(method, params, callback) on the specific
        remote object.
        """
        if not self._server:
            return
        info = self._clients.get(remote_uuid)
        if not info:
            return
        remote = info.get("remote")
        if not remote:
            return
        method = f"AcApp.{event_name}"
        try:
            call_attr = getattr(remote, 'call', None)
            if callable(call_attr):
                result = call_attr(method, [data], lambda *a: None)
                if asyncio.isfuture(result) or asyncio.iscoroutine(result):
                    asyncio.ensure_future(result)
        except Exception as e:
            logger.warning(f"Send {event_name} to {remote_uuid} failed: {e}")

    # === RPC Methods (exposed as Collab.*) ===

    def admit_client(self, client_id):
        """Admit a pending client. Can be called by any admitted user."""
        pending = None
        for pid, pinfo in self._pending.items():
            if pid == client_id:
                pending = pinfo
                break

        if not pending:
            return {"error": f"No pending client with id {client_id}"}

        future = pending.get("future")
        if future and not future.done():
            future.set_result(True)

        # Broadcast immediately so all hosts remove the toast
        self._broadcast_event("admissionResult", {
            "client_id": client_id,
            "ip": pending.get("ip", ""),
            "admitted": True,
        })

        return {"ok": True, "client_id": client_id}

    def deny_client(self, client_id):
        """Deny a pending client. Closes their WebSocket."""
        pending = None
        for pid, pinfo in self._pending.items():
            if pid == client_id:
                pending = pinfo
                break

        if not pending:
            return {"error": f"No pending client with id {client_id}"}

        future = pending.get("future")
        if future and not future.done():
            future.set_result(False)

        # Broadcast immediately so all hosts remove the toast
        self._broadcast_event("admissionResult", {
            "client_id": client_id,
            "ip": pending.get("ip", ""),
            "admitted": False,
        })

        return {"ok": True, "client_id": client_id}

    def get_connected_clients(self):
        """Return the list of currently connected clients."""
        result = []
        for ruuid in self._admission_order:
            info = self._clients.get(ruuid)
            if not info:
                continue
            result.append({
                "client_id": info["client_id"],
                "ip": info["ip"],
                "role": info["role"],
                "is_localhost": info["is_localhost"],
            })
        return result

    def get_collab_role(self):
        """Return the calling client's own role and permissions."""
        info = self._get_caller_info()
        if not info:
            # Fallback for single-user / no tracking
            return {
                "role": "host",
                "is_localhost": True,
                "client_id": None,
            }
        return {
            "role": info["role"],
            "is_localhost": info["is_localhost"],
            "client_id": info["client_id"],
        }


class CollabServer(JRPCServer):
    """WebSocket server with connection admission screening.

    Extends JRPCServer to:
    - Auto-admit the first connection as host
    - Hold subsequent connections pending until admitted
    - Track which remote triggered each RPC call
    - Support host promotion on disconnect
    """

    def __init__(self, port, collab=None, remote_timeout=60, ssl_context=None):
        super().__init__(port, remote_timeout=remote_timeout, ssl_context=ssl_context)
        self._collab = collab or Collab()
        self._collab._server = self
        self._current_caller_uuid = None
        self._first_connection_done = False

    @property
    def collab(self):
        return self._collab

    async def handle_connection(self, websocket):
        """Override JRPCServer.handle_connection to insert admission screening."""
        try:
            peer_ip = websocket.remote_address[0]
        except Exception:
            peer_ip = "unknown"

        if not self._first_connection_done:
            # First connection — auto-admit as host
            self._first_connection_done = True
            await self._run_admitted_connection(websocket, peer_ip, role="host")
        else:
            # Subsequent connection — require admission
            admitted = await self._wait_for_admission(websocket, peer_ip)
            if not admitted:
                try:
                    await websocket.close(1008, "Denied")
                except Exception:
                    pass
                return
            await self._run_admitted_connection(websocket, peer_ip, role="participant")

    async def _wait_for_admission(self, websocket, peer_ip):
        """Hold a connection pending until admitted or denied.

        Sends raw WebSocket messages (not JRPC) to the pending client.
        Broadcasts admissionRequest to all admitted clients.
        Returns True if admitted, False if denied or timed out.
        """
        import json

        client_id = str(uuid.uuid4())
        loop = asyncio.get_event_loop()
        future = loop.create_future()

        # Cancel any existing pending request from the same IP
        # (e.g. client refreshed their browser while waiting)
        for old_id, old_info in list(self._collab._pending.items()):
            if old_info["ip"] == peer_ip:
                old_future = old_info.get("future")
                if old_future and not old_future.done():
                    old_future.set_result(False)
                self._collab._pending.pop(old_id, None)
                # Notify admitted clients to remove the stale toast
                self._collab._broadcast_event("admissionResult", {
                    "client_id": old_id,
                    "ip": peer_ip,
                    "admitted": False,
                    "replaced": True,
                })

        # Register pending
        self._collab._pending[client_id] = {
            "client_id": client_id,
            "ip": peer_ip,
            "websocket": websocket,
            "future": future,
            "requested_at": time.time(),
        }

        # Send admission_pending to the new client
        try:
            await websocket.send(json.dumps({
                "type": "admission_pending",
                "client_id": client_id,
            }))
        except Exception:
            self._collab._pending.pop(client_id, None)
            return False

        # Broadcast admissionRequest to all admitted clients
        self._collab._broadcast_event("admissionRequest", {
            "client_id": client_id,
            "ip": peer_ip,
            "requested_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        })

        # Wait for admit/deny decision with timeout.
        # Also watch for WebSocket close (client refreshed or cancelled).
        ws_closed = asyncio.ensure_future(websocket.wait_closed())
        try:
            done, _pending_tasks = await asyncio.wait(
                [asyncio.ensure_future(future), ws_closed],
                timeout=120,
                return_when=asyncio.FIRST_COMPLETED,
            )
            if future.done():
                admitted = future.result()
            else:
                admitted = False
                if ws_closed.done():
                    logger.info(f"Pending client disconnected: {client_id} ({peer_ip})")
                else:
                    logger.info(f"Admission timeout for {client_id} ({peer_ip})")
                # Broadcast immediately so hosts remove the toast
                self._collab._broadcast_event("admissionResult", {
                    "client_id": client_id,
                    "ip": peer_ip,
                    "admitted": False,
                })
        except asyncio.TimeoutError:
            admitted = False
            logger.info(f"Admission timeout for {client_id} ({peer_ip})")
        finally:
            # Clean up the tasks we created
            if not future.done():
                future.cancel()
            if not ws_closed.done():
                ws_closed.cancel()

        # Clean up pending entry
        self._collab._pending.pop(client_id, None)

        # Notify the pending client
        try:
            if admitted:
                await websocket.send(json.dumps({
                    "type": "admission_granted",
                    "client_id": client_id,
                }))
            else:
                await websocket.send(json.dumps({
                    "type": "admission_denied",
                    "client_id": client_id,
                    "reason": "Denied by host",
                }))
        except Exception:
            pass

        # Broadcast result to admitted clients.
        # (For admit/deny this duplicates the broadcast in admit_client/deny_client
        # but is needed for timeout and disconnect paths.)
        if not admitted:
            self._collab._broadcast_event("admissionResult", {
                "client_id": client_id,
                "ip": peer_ip,
                "admitted": False,
            })

        return admitted

    async def _run_admitted_connection(self, websocket, peer_ip, role="participant"):
        """Run the JRPC receive loop for an admitted connection.

        Mirrors JRPCServer.handle_connection but adds caller tracking
        via _current_caller_uuid before each message dispatch.
        """
        # Create JRPC remote
        remote = self.create_remote(websocket)
        remote_uuid = remote.uuid

        # Register in collab client registry
        self._collab._register_client(remote_uuid, peer_ip, role=role, websocket=websocket, remote=remote)

        # Broadcast clientJoined
        client_info = self._collab._clients.get(remote_uuid, {})
        self._collab._broadcast_event("clientJoined", {
            "client_id": client_info.get("client_id", ""),
            "ip": peer_ip,
            "role": role,
            "is_localhost": client_info.get("is_localhost", False),
        })

        try:
            async for message in websocket:
                self._current_caller_uuid = remote_uuid
                data = message if isinstance(message, str) else message.decode()
                remote.receive(data)
        except Exception as e:
            logger.debug(f"Connection error for {peer_ip}: {e}")
        finally:
            self._current_caller_uuid = None
            self._collab._unregister_client(remote_uuid)

            # If no clients remain, reset first_connection_done
            if not self._collab._clients:
                self._first_connection_done = False
                logger.info("All clients disconnected — server reset")