"""Collaboration mode — Layer 4.4.1.

Admission-gated multi-browser connections on a single backend. The
first connection is auto-admitted as the host; subsequent connections
are held in a pending state until an already-admitted user approves
(or denies) them via a UI prompt. Non-localhost participants can
browse, search, and view state but cannot mutate — the restriction
is enforced at the service layer via :meth:`Collab.is_caller_localhost`
which downstream service methods consult.

Governing spec: ``specs4/4-features/collaboration.md``.

Design points pinned here:

- **``handle_connection`` is fully overridden.** The base
  :class:`JRPCServer` implementation creates a JRPC2 remote
  immediately and starts the ``system.listComponents`` handshake,
  making the client a full participant. We can't let that happen
  before admission approval. The override runs a four-step
  sequence: (1) detect localhost, (2) if first connection
  auto-admit and fall through to normal JRPC setup; (3) otherwise
  send a raw ``admission_pending`` message on the bare WebSocket
  and await approval via an asyncio Future resolved by
  :meth:`Collab.admit_client` / :meth:`Collab.deny_client`; (4) on
  admit, call ``super().handle_connection`` to complete setup; on
  deny or timeout, close the socket with code 1008.

- **Custom message receive loop for caller tracking.** The base
  class runs its receive loop inside ``handle_connection``. For
  admitted clients we must set ``_current_caller_uuid`` on the
  server before each message dispatch so service methods can ask
  "who is calling me?" via :meth:`Collab.is_caller_localhost`.
  This means we replicate the base class's receive loop with an
  extra assignment before ``remote.receive(message)``.

- **Raw WebSocket messages before JRPC setup.** Pending clients
  receive JSON frames directly on the underlying WebSocket —
  these are NOT JRPC messages because JRPC hasn't been set up
  yet. The browser-side collab code intercepts these before
  jrpc-oo's message handler sees them (see specs4/4-features/
  collaboration.md#pending-state-pre-jrpc).

- **Localhost detection includes local network interfaces.** A
  user opening their browser via the LAN IP (e.g. for mobile
  testing) rather than via ``localhost`` should still count as
  localhost for mutation purposes. We detect by collecting every
  IP address bound to any local interface and comparing peer IPs
  against the set. Loopback addresses (``127.0.0.0/8``, ``::1``)
  are always localhost regardless of interface detection.

- **Pending queue cancellation on disconnect.** If a pending
  client closes their browser before admission, the admission
  Future is cancelled and the pending request is removed from
  the queue. Without this, stale pending entries would
  accumulate every time a user gave up waiting. Uses
  ``asyncio.wait`` with the Future racing ``websocket.wait_closed``
  so a disconnect wakes the wait loop immediately.

- **Same-IP replacement.** If a browser refreshes while its
  earlier connection is still pending, the old pending request
  is auto-denied and replaced. Prevents a user's browser history
  from accumulating dead pending tabs after a few reloads.

- **Host promotion on disconnect.** When the host disconnects,
  the next admitted client by ``admitted_at`` timestamp is
  promoted to host. Triggers a ``roleChanged`` push to the
  promoted client and a ``clientJoined`` refresh to all clients
  so UI badges update.
"""

from __future__ import annotations

import asyncio
import ipaddress
import json
import logging
import socket
import time
import uuid as uuid_module
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Optional

from ac_dc.rpc import DEFAULT_MAX_MESSAGE_SIZE, MaxSizeJRPCServer

if TYPE_CHECKING:
    import websockets.legacy.server

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Module constants
# ---------------------------------------------------------------------------


# How long a pending admission request can wait before auto-deny.
# Long enough that the host has time to notice the toast and
# decide (2 minutes per spec); short enough that abandoned
# connections don't accumulate indefinitely.
_PENDING_TIMEOUT_SECONDS = 120.0

# Message types emitted on the raw WebSocket before JRPC setup.
# These are plain JSON frames, not JRPC messages — the browser
# intercepts them via a capturing listener before jrpc-oo's
# message handler sees them.
_MSG_ADMISSION_PENDING = "admission_pending"
_MSG_ADMISSION_GRANTED = "admission_granted"
_MSG_ADMISSION_DENIED = "admission_denied"

# Close codes used when rejecting connections. 1008 is
# "policy violation" — the semantically correct code for an
# admission denial.
_CLOSE_CODE_DENIED = 1008


# ---------------------------------------------------------------------------
# Data classes — client registry + pending queue
# ---------------------------------------------------------------------------


@dataclass
class ConnectedClient:
    """One admitted client's registry entry.

    The registry is the authoritative source for "who is
    connected and what can they do". The :class:`Collab`
    service queries it for role checks, enumeration, and
    caller-localhost determination.
    """

    client_id: str
    ip: str
    role: str  # "host" or "participant"
    is_localhost: bool
    admitted_at: float  # epoch seconds
    websocket: Any  # websockets.legacy.server.WebSocketServerProtocol
    # JRPC2 remote uuid — set after create_remote completes.
    # Used by the caller-tracking path to map incoming RPC
    # calls back to a ConnectedClient for localhost checks.
    remote_uuid: Optional[str] = None


@dataclass
class PendingRequest:
    """One unresolved admission request.

    Created when a non-first connection arrives. Resolved by
    :meth:`Collab.admit_client` or :meth:`Collab.deny_client`
    setting the Future's result; or by auto-deny timeout; or
    by the pending client's WebSocket closing first.
    """

    client_id: str
    ip: str
    websocket: Any
    # Resolved to True (admit) or False (deny) by the Collab
    # service when an admitted client calls admit/deny_client.
    # Timeout and early-disconnect also resolve it (to False and
    # None respectively; see _wait_for_admission).
    future: asyncio.Future
    requested_at: float  # epoch seconds


# ---------------------------------------------------------------------------
# Localhost detection
# ---------------------------------------------------------------------------


def _is_loopback(ip: str) -> bool:
    """Return True for loopback addresses.

    Matches ``127.0.0.0/8`` (IPv4) and ``::1`` (IPv6). The
    stdlib's ``ipaddress.ip_address(...).is_loopback`` covers
    both — we use it directly rather than string-matching
    ``"127."`` prefixes, which would miss IPv6 loopback.
    """
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return False


def _local_interface_ips() -> set[str]:
    """Collect every IP bound to a local network interface.

    Used by :func:`is_localhost_ip` to recognise "my LAN IP" as
    localhost. The naive approach (``socket.gethostbyname_ex``)
    only returns the primary hostname's addresses, which misses
    virtual interfaces and IPv6. ``socket.getaddrinfo`` with the
    hostname also varies by resolver configuration.

    We use ``socket.if_nameindex`` + ``getaddrinfo`` to enumerate
    interfaces, falling back to ``gethostbyname_ex`` if the
    former isn't available on the platform. Any detection
    failure logs and returns an empty set — the loopback check
    in :func:`is_localhost_ip` still catches the common case.
    """
    ips: set[str] = set()
    try:
        # Primary hostname and its aliases — covers the normal
        # case on Linux/macOS/Windows.
        hostname = socket.gethostname()
        try:
            _, _, addrs = socket.gethostbyname_ex(hostname)
            ips.update(addrs)
        except socket.gaierror:
            pass
        # Also try getaddrinfo which picks up IPv6.
        try:
            infos = socket.getaddrinfo(
                hostname, None, proto=socket.IPPROTO_TCP
            )
            for info in infos:
                addr = info[4][0]
                # Strip IPv6 scope (e.g. fe80::1%eth0 → fe80::1)
                if "%" in addr:
                    addr = addr.split("%", 1)[0]
                ips.add(addr)
        except socket.gaierror:
            pass
    except Exception as exc:
        # Defensive — if detection fails entirely, the loopback
        # check in is_localhost_ip still catches the primary case.
        logger.debug(
            "Failed to enumerate local interface IPs: %s", exc
        )
    return ips


def is_localhost_ip(ip: str) -> bool:
    """Return True when ``ip`` is the local machine.

    Checks loopback first (cheap), then enumerates local
    interface IPs. Matches even when the user opens their
    browser via the LAN IP rather than via ``localhost`` —
    specs4/4-features/collaboration.md#localhost-detection
    requires this so that the host's mobile device on the same
    LAN still counts as the host, not a participant.
    """
    if _is_loopback(ip):
        return True
    return ip in _local_interface_ips()


# ---------------------------------------------------------------------------
# Collab service class
# ---------------------------------------------------------------------------


class Collab:
    """Admission RPCs + client registry for collaboration mode.

    Registered as a service on :class:`CollabServer` via
    ``add_class``. Holds the registry (admitted clients) and
    the pending queue. Exposed RPC methods:

    - :meth:`admit_client` — admit a pending request
    - :meth:`deny_client` — deny a pending request
    - :meth:`get_connected_clients` — registry enumeration
    - :meth:`get_collab_role` — caller's own role

    Internal methods (not auto-exposed because they start with
    ``_``) handle registry mutation, pending queue management,
    and localhost determination.
    """

    def __init__(self) -> None:
        # Admitted clients, keyed by client_id.
        self._clients: dict[str, ConnectedClient] = {}
        # Pending admission requests, keyed by client_id.
        self._pending: dict[str, PendingRequest] = {}
        # Server reference — set by CollabServer.__init__ after
        # constructing this instance. Used by the caller-tracking
        # path to read the current caller UUID.
        self._server: Optional[CollabServer] = None

    # ------------------------------------------------------------------
    # Registry management (internal)
    # ------------------------------------------------------------------

    def _is_first_connection(self) -> bool:
        """True when no clients are admitted yet.

        The first connection is auto-admitted as host — it's the
        user who started the process and opened their own
        browser. No admission flow makes sense for them.
        """
        return not self._clients

    def _register_client(
        self,
        client_id: str,
        ip: str,
        role: str,
        websocket: Any,
    ) -> ConnectedClient:
        """Add a client to the registry.

        Called after admission is granted (including the
        auto-admitted first connection). The ``remote_uuid``
        is set later by :meth:`_attach_remote_uuid` once the
        JRPC2 remote has been created — caller-tracking needs
        to map remote UUIDs back to client IDs.
        """
        client = ConnectedClient(
            client_id=client_id,
            ip=ip,
            role=role,
            is_localhost=is_localhost_ip(ip),
            admitted_at=time.time(),
            websocket=websocket,
        )
        self._clients[client_id] = client
        return client

    def _attach_remote_uuid(
        self, client_id: str, remote_uuid: str
    ) -> None:
        """Record the JRPC2 remote UUID for caller-tracking.

        The JRPC2 remote is created AFTER the client is
        registered (registration happens pre-handshake, the
        remote is created when JRPC setup begins). We store the
        UUID so :meth:`is_caller_localhost` can look up the
        localhost flag by remote UUID.
        """
        client = self._clients.get(client_id)
        if client is not None:
            client.remote_uuid = remote_uuid

    def _unregister_client(
        self, client_id: str
    ) -> Optional[ConnectedClient]:
        """Remove a client from the registry on disconnect.

        Returns the removed entry so the caller can use it for
        disconnect broadcasts (we need the IP + role before
        removal for the ``clientLeft`` event).
        """
        return self._clients.pop(client_id, None)

    def _promote_next_host(self) -> Optional[ConnectedClient]:
        """Promote the next admitted client to host.

        Called when the current host disconnects. Picks the
        earliest-admitted remaining client (stable tiebreaker
        for edge cases where admission timestamps match to the
        microsecond) and flips their role. Returns the
        promoted client, or None if no candidates remain.
        """
        if not self._clients:
            return None
        # Sort by admission time; earliest wins.
        candidates = sorted(
            self._clients.values(),
            key=lambda c: c.admitted_at,
        )
        for candidate in candidates:
            if candidate.role != "host":
                candidate.role = "host"
                return candidate
        # Already have a host — nothing to promote.
        return None

    def _has_host(self) -> bool:
        """True when any admitted client has role 'host'."""
        return any(c.role == "host" for c in self._clients.values())

    # ------------------------------------------------------------------
    # Pending queue management (internal)
    # ------------------------------------------------------------------

    def _register_pending(
        self, ip: str, websocket: Any
    ) -> PendingRequest:
        """Create a pending admission request.

        Same-IP duplicate protection: if an older pending
        request exists from the same IP (e.g. the user refreshed
        their browser), auto-deny the old one. Prevents the UI
        from accumulating stale toasts.
        """
        # Auto-deny any pending requests from the same IP.
        to_cancel: list[PendingRequest] = [
            req for req in self._pending.values() if req.ip == ip
        ]
        for req in to_cancel:
            if not req.future.done():
                req.future.set_result(False)
            self._pending.pop(req.client_id, None)

        client_id = str(uuid_module.uuid4())
        request = PendingRequest(
            client_id=client_id,
            ip=ip,
            websocket=websocket,
            future=asyncio.get_event_loop().create_future(),
            requested_at=time.time(),
        )
        self._pending[client_id] = request
        return request

    def _remove_pending(self, client_id: str) -> None:
        """Drop a pending request without resolving its Future.

        Called by the admission loop in CollabServer after a
        decision — the Future is already resolved at that point.
        """
        self._pending.pop(client_id, None)

    # ------------------------------------------------------------------
    # Caller-tracking — who called the current RPC?
    # ------------------------------------------------------------------

    def is_caller_localhost(self) -> bool:
        """Return True when the current RPC caller is localhost.

        Reads ``_current_caller_uuid`` from the server (set by
        the message-receive loop before each dispatch), looks
        up the client, returns their ``is_localhost`` flag.

        When the call isn't from an admitted client (e.g., called
        internally from a test or a background task), returns
        True — non-RPC contexts are always trusted. This is the
        safe default because the restriction is specifically for
        *remote* callers; local Python code accessing the same
        methods shouldn't be gated.
        """
        if self._server is None:
            return True
        caller_uuid = self._server.current_caller_uuid
        if caller_uuid is None:
            return True
        # Find the client with this remote_uuid.
        for client in self._clients.values():
            if client.remote_uuid == caller_uuid:
                return client.is_localhost
        # Unknown caller — be strict.
        return False

    # ------------------------------------------------------------------
    # RPC methods — exposed via add_class
    # ------------------------------------------------------------------

    def admit_client(self, client_id: str) -> dict[str, Any]:
        """Admit a pending client.

        Called by any admitted user (typically the host) via the
        admission toast in their UI. Resolves the pending
        request's Future to True; the server's admission loop
        picks this up and completes JRPC setup for the pending
        WebSocket.

        Idempotent — calling on an unknown or already-resolved
        request returns an error but doesn't raise.
        """
        request = self._pending.get(client_id)
        if request is None:
            return {"error": f"Unknown pending client: {client_id}"}
        if request.future.done():
            return {
                "error": (
                    f"Pending request {client_id} already resolved"
                )
            }
        request.future.set_result(True)
        return {"ok": True, "client_id": client_id}

    def deny_client(self, client_id: str) -> dict[str, Any]:
        """Deny a pending client.

        Mirrors :meth:`admit_client` — resolves the Future to
        False, and the server's admission loop closes the
        WebSocket with policy-violation code.
        """
        request = self._pending.get(client_id)
        if request is None:
            return {"error": f"Unknown pending client: {client_id}"}
        if request.future.done():
            return {
                "error": (
                    f"Pending request {client_id} already resolved"
                )
            }
        request.future.set_result(False)
        return {"ok": True, "client_id": client_id}

    def get_connected_clients(self) -> list[dict[str, Any]]:
        """Return a serialisable snapshot of the registry.

        Used by the browser to render the connected-users
        popover. Strips the non-serialisable websocket field.
        Sorted by admission time so the order is stable across
        successive polls.
        """
        ordered = sorted(
            self._clients.values(),
            key=lambda c: c.admitted_at,
        )
        return [
            {
                "client_id": c.client_id,
                "ip": c.ip,
                "role": c.role,
                "is_localhost": c.is_localhost,
            }
            for c in ordered
        ]

    def get_collab_role(self) -> dict[str, Any]:
        """Return the calling client's own role snapshot.

        Browser calls this after JRPC setup to learn whether
        it's a host or participant, and whether it's a
        localhost client (which determines mutation rights).
        """
        if self._server is None:
            return {"error": "server not wired"}
        caller_uuid = self._server.current_caller_uuid
        if caller_uuid is None:
            return {"error": "no caller"}
        for client in self._clients.values():
            if client.remote_uuid == caller_uuid:
                return {
                    "role": client.role,
                    "is_localhost": client.is_localhost,
                    "client_id": client.client_id,
                }
        return {"error": "caller not in registry"}


# ---------------------------------------------------------------------------
# CollabServer
# ---------------------------------------------------------------------------


class CollabServer(MaxSizeJRPCServer):
    """JRPCServer subclass with admission screening.

    Construct like a normal :class:`JRPCServer`, but pass in a
    :class:`Collab` instance. The server overrides
    :meth:`handle_connection` to insert the admission flow and
    runs its own message-receive loop for admitted clients to
    track the current caller's UUID.

    Usage::

        collab = Collab()
        server = CollabServer(port=18080, collab=collab)
        server.add_class(collab, 'Collab')
        server.add_class(llm_service)
        server.add_class(repo)
        await server.start()
    """

    def __init__(
        self,
        port: int = 9000,
        remote_timeout: int = 60,
        collab: Optional[Collab] = None,
        ssl_context: Any = None,
        max_size: int = DEFAULT_MAX_MESSAGE_SIZE,
    ) -> None:
        super().__init__(
            port=port,
            remote_timeout=remote_timeout,
            ssl_context=ssl_context,
            max_size=max_size,
        )
        self._collab = collab if collab is not None else Collab()
        self._collab._server = self
        # Current-caller tracking. Set by the admitted-client
        # receive loop before each ``remote.receive(message)``
        # dispatch; read by :meth:`Collab.is_caller_localhost`.
        # Single-value because a running asyncio event loop
        # dispatches one message at a time — no need for a
        # thread-local or contextvar.
        self.current_caller_uuid: Optional[str] = None

    @property
    def collab(self) -> Collab:
        """The attached Collab service."""
        return self._collab

    # ------------------------------------------------------------------
    # handle_connection — the admission flow
    # ------------------------------------------------------------------

    async def handle_connection(self, websocket: Any) -> None:
        """Screen the connection, then dispatch to the normal flow.

        Overrides :meth:`JRPCServer.handle_connection`. Order
        of operations:

        1. Extract peer IP and determine localhost status.
        2. If no clients are admitted yet → auto-admit as host.
        3. Otherwise → send ``admission_pending``, broadcast
           ``admissionRequest``, wait for admit/deny/timeout/
           disconnect.
        4. On admit → send ``admission_granted``, run the
           admitted-client receive loop (which sets
           ``current_caller_uuid`` before each dispatch).
        5. On deny/timeout → send ``admission_denied``, close.
        6. On disconnect → clean up registry, promote new host
           if necessary, broadcast ``clientLeft``.
        """
        peer_ip = self._extract_peer_ip(websocket)
        is_first = self._collab._is_first_connection()

        if is_first:
            # First connection — auto-admit as host.
            client = self._collab._register_client(
                client_id=str(uuid_module.uuid4()),
                ip=peer_ip,
                role="host",
                websocket=websocket,
            )
            try:
                await self._run_admitted_connection(websocket, client)
            finally:
                await self._handle_disconnect(client)
            return

        # Non-first connection — admission required.
        admitted = await self._admission_flow(websocket, peer_ip)
        if admitted is None:
            # Denied / timed out / disconnected pre-decision.
            return

        # Admitted — run the normal flow with caller tracking.
        try:
            await self._run_admitted_connection(websocket, admitted)
        finally:
            await self._handle_disconnect(admitted)

    # ------------------------------------------------------------------
    # Admission flow
    # ------------------------------------------------------------------

    async def _admission_flow(
        self, websocket: Any, peer_ip: str
    ) -> Optional[ConnectedClient]:
        """Hold the connection in pending state until resolved.

        Sends raw ``admission_pending`` JSON on the WebSocket,
        broadcasts the request to admitted clients, then waits
        for one of:

        - admit/deny via :meth:`Collab.admit_client` /
          :meth:`Collab.deny_client` (resolves the Future)
        - timeout (auto-deny after _PENDING_TIMEOUT_SECONDS)
        - websocket closure from the pending side (user closed
          their browser before decision)

        Returns the :class:`ConnectedClient` on admit, None on
        any failure path (caller closes the socket if needed).
        """
        request = self._collab._register_pending(peer_ip, websocket)

        # Tell the pending client they're waiting. Raw JSON on
        # the WebSocket — the browser intercepts before JRPC.
        try:
            await websocket.send(json.dumps({
                "type": _MSG_ADMISSION_PENDING,
                "client_id": request.client_id,
            }))
        except Exception as exc:
            logger.debug(
                "Failed to send admission_pending: %s", exc
            )
            self._collab._remove_pending(request.client_id)
            return None

        # Broadcast admissionRequest to admitted clients.
        await self._broadcast_admission_request(request)

        # Race the Future against websocket closure and timeout.
        close_task = asyncio.ensure_future(websocket.wait_closed())
        try:
            done, _ = await asyncio.wait(
                {request.future, close_task},
                timeout=_PENDING_TIMEOUT_SECONDS,
                return_when=asyncio.FIRST_COMPLETED,
            )
        except Exception as exc:
            logger.warning(
                "Error awaiting admission for %s: %s",
                request.client_id, exc,
            )
            done = set()

        # Clean up the race partners regardless of outcome.
        close_task.cancel()
        self._collab._remove_pending(request.client_id)

        # Determine outcome.
        if request.future in done and not request.future.cancelled():
            admitted = request.future.result()
        else:
            # Timeout or pre-admission disconnect.
            admitted = False
            if not request.future.done():
                request.future.set_result(False)

        if not admitted:
            # Deny path. If the socket is still open, tell the
            # client and close cleanly.
            try:
                await websocket.send(json.dumps({
                    "type": _MSG_ADMISSION_DENIED,
                    "client_id": request.client_id,
                }))
            except Exception:
                pass
            try:
                await websocket.close(
                    code=_CLOSE_CODE_DENIED, reason="Admission denied"
                )
            except Exception:
                pass
            # Notify admitted clients that the pending request
            # was resolved.
            await self._broadcast_admission_result(
                request, admitted=False
            )
            return None

        # Admit path. Tell the client, register them, broadcast.
        try:
            await websocket.send(json.dumps({
                "type": _MSG_ADMISSION_GRANTED,
                "client_id": request.client_id,
            }))
        except Exception as exc:
            logger.warning(
                "Failed to send admission_granted: %s", exc
            )
            return None

        client = self._collab._register_client(
            client_id=request.client_id,
            ip=peer_ip,
            role="participant",
            websocket=websocket,
        )
        await self._broadcast_admission_result(request, admitted=True)
        return client

    # ------------------------------------------------------------------
    # Admitted-client connection handling
    # ------------------------------------------------------------------

    async def _run_admitted_connection(
        self, websocket: Any, client: ConnectedClient
    ) -> None:
        """Run the JRPC handshake + receive loop for an admitted client.

        This replaces the base class's ``handle_connection``
        body for admitted clients. Creates the JRPC2 remote,
        attaches its UUID to the registry entry, then runs the
        receive loop while setting ``current_caller_uuid``
        before each dispatch.
        """
        # create_remote initiates the JRPC handshake
        # (system.listComponents). After this call the client is
        # a full RPC participant.
        remote = self.create_remote(websocket)
        self._collab._attach_remote_uuid(
            client.client_id, remote.uuid
        )

        # Broadcast clientJoined now that the registry entry is
        # complete (remote uuid attached).
        await self._broadcast_client_joined(client)

        try:
            async for message in websocket:
                # Set the current caller BEFORE dispatching, so
                # any service method invoked during this message
                # can consult Collab.is_caller_localhost.
                self.current_caller_uuid = remote.uuid
                try:
                    if isinstance(message, bytes):
                        message = message.decode("utf-8")
                    remote.receive(message)
                finally:
                    self.current_caller_uuid = None
        except Exception as exc:
            # websockets.ConnectionClosed and similar are normal
            # disconnect signals. Debug log and let the finally
            # block handle cleanup.
            logger.debug(
                "Admitted connection %s ended: %s",
                client.client_id, exc,
            )
        finally:
            # The base class's rm_remote cleans up JRPC state.
            # We still need our own registry cleanup in
            # _handle_disconnect (called by the outer frame).
            self.rm_remote(None, remote.uuid)

    async def _handle_disconnect(
        self, client: ConnectedClient
    ) -> None:
        """Clean up registry, promote new host, broadcast.

        Called from ``handle_connection`` in an async ``finally``
        block so it runs on every disconnect path (normal close,
        network error, explicit deny).

        Async so we can ``await`` the broadcast tasks inline —
        the original fire-and-forget pattern via
        ``asyncio.ensure_future`` left the broadcast tasks
        unstarted when ``handle_connection`` returned, so tests
        asserting on ``clientLeft`` events fired after the
        connection closed would see empty event lists. The
        broadcasts are cheap (single ``self.call`` dispatch with
        a graceful no-op when no AcApp is registered), so
        awaiting them adds no meaningful latency to the
        disconnect path.
        """
        removed = self._collab._unregister_client(client.client_id)
        if removed is None:
            return

        # If the disconnecting client was the host, promote the
        # next admitted client.
        promoted: Optional[ConnectedClient] = None
        if removed.role == "host" and not self._collab._has_host():
            promoted = self._collab._promote_next_host()

        await self._broadcast_client_left(removed)
        if promoted is not None:
            await self._broadcast_role_changed(promoted)

    # ------------------------------------------------------------------
    # Broadcasts — fire-and-forget server-push events
    # ------------------------------------------------------------------

    async def _broadcast_admission_request(
        self, request: PendingRequest
    ) -> None:
        """Push ``AcApp.admissionRequest`` to all admitted clients.

        Admitted clients' UIs receive this and render an
        admission toast. The broadcast goes via ``self.call``
        which jrpc-oo sets up when AcApp has been registered on
        any remote. When no remotes expose AcApp (e.g., tests),
        the call fails silently.
        """
        payload = {
            "client_id": request.client_id,
            "ip": request.ip,
            "requested_at": request.requested_at,
        }
        await self._push_event("admissionRequest", payload)

    async def _broadcast_admission_result(
        self, request: PendingRequest, admitted: bool
    ) -> None:
        """Push ``AcApp.admissionResult`` to all admitted clients.

        Fired after admit/deny/timeout resolves. Admitted
        clients' UIs dismiss the admission toast.
        """
        payload = {
            "client_id": request.client_id,
            "ip": request.ip,
            "admitted": admitted,
        }
        await self._push_event("admissionResult", payload)

    async def _broadcast_client_joined(
        self, client: ConnectedClient
    ) -> None:
        """Push ``AcApp.clientJoined`` after admission + JRPC setup."""
        payload = {
            "client_id": client.client_id,
            "ip": client.ip,
            "role": client.role,
            "is_localhost": client.is_localhost,
        }
        await self._push_event("clientJoined", payload)

    async def _broadcast_client_left(
        self, client: ConnectedClient
    ) -> None:
        """Push ``AcApp.clientLeft`` on disconnect."""
        payload = {
            "client_id": client.client_id,
            "ip": client.ip,
            "role": client.role,
        }
        await self._push_event("clientLeft", payload)

    async def _broadcast_role_changed(
        self, client: ConnectedClient
    ) -> None:
        """Push ``AcApp.roleChanged`` after host promotion."""
        payload = {
            "client_id": client.client_id,
            "role": client.role,
            "reason": "previous host disconnected",
        }
        await self._push_event("roleChanged", payload)

    async def _push_event(
        self, event_name: str, payload: Any
    ) -> None:
        """Fire a server-push event via jrpc-oo's broadcast proxy.

        Resolves ``self.call["AcApp.<event>"]`` and invokes it
        with the payload. When no client has registered an
        AcApp class (before setup, or in tests), ``self.call``
        has no such key and we silently skip — event broadcast
        is always best-effort.
        """
        method_name = f"AcApp.{event_name}"
        fn = self.call.get(method_name) if isinstance(
            self.call, dict
        ) else None
        if fn is None:
            logger.debug(
                "No remote exposes %s; dropping broadcast",
                method_name,
            )
            return
        try:
            await fn(payload)
        except Exception as exc:
            logger.debug(
                "Broadcast of %s failed: %s", method_name, exc
            )

    # ------------------------------------------------------------------
    # Peer IP extraction
    # ------------------------------------------------------------------

    @staticmethod
    def _extract_peer_ip(websocket: Any) -> str:
        """Return the peer IP for a websocket.

        websockets library exposes ``websocket.remote_address``
        as a ``(host, port, ...)`` tuple. Returns the host
        portion. Falls back to ``"unknown"`` when the attribute
        isn't present (e.g., a test fake).
        """
        remote = getattr(websocket, "remote_address", None)
        if remote is None:
            return "unknown"
        try:
            return remote[0]
        except (IndexError, TypeError):
            return "unknown"