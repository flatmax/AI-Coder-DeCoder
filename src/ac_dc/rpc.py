"""RPC transport layer.

Thin wrapper around the :mod:`jrpc_oo` library. Provides:

- Port discovery (:func:`find_available_port`)
- Event-loop reference capture (:class:`EventLoopHandle`) — the
  "capture-at-entry" contract from specs4/3-llm/streaming.md that
  worker threads must use a captured loop reference rather than
  re-acquiring one inside the worker.
- Service registration facade (:class:`RpcServer`) — composition
  over inheritance around :class:`jrpc_oo.JRPCServer`.

Governing specs: ``specs4/1-foundation/rpc-transport.md`` and
``specs4/1-foundation/jrpc-oo.md``.
"""

from __future__ import annotations

import asyncio
import logging
import socket
from typing import TYPE_CHECKING, Any, Coroutine

import websockets
from jrpc_oo import JRPCServer

if TYPE_CHECKING:
    import concurrent.futures

logger = logging.getLogger(__name__)


# Default starting port for the RPC WebSocket server. Matches the CLI
# default in :mod:`ac_dc.cli` so the two stay in lockstep. Kept as a
# module constant so tests can import the canonical value without
# constructing an ArgumentParser.
DEFAULT_SERVER_PORT = 18080

# How many ports to try when scanning for a free one. Enough that a
# busy developer laptop can still find a free port; not so many that
# a pathological "every port in this range is taken" case hangs the
# user for minutes.
_PORT_SCAN_RANGE = 50

# Default remote-call timeout for jrpc-oo, in seconds. Matches the
# 120s figure in specs4/1-foundation/rpc-transport.md — long enough
# for slow operations (large symbol-index rebuilds, multi-MB diffs)
# but short enough that a truly wedged remote doesn't stall forever.
DEFAULT_REMOTE_TIMEOUT = 120.0

# Maximum WebSocket message size in bytes. The underlying
# ``websockets`` library defaults to 1 MiB, which is too small for
# AC-DC: users routinely paste screenshots as data URIs inside
# chat_streaming args, and a single 2-megapixel PNG base64-encoded
# easily exceeds 1 MiB. When a frame exceeds the limit the server
# closes with code 1009 and the browser silently reconnects,
# dropping the user's message. 64 MiB is generous enough to cover
# a handful of high-resolution screenshots per message while still
# providing back-pressure against pathological payloads.
DEFAULT_MAX_MESSAGE_SIZE = 64 * 1024 * 1024


# ---------------------------------------------------------------------------
# Port discovery
# ---------------------------------------------------------------------------


def find_available_port(
    start: int = DEFAULT_SERVER_PORT,
    max_tries: int = _PORT_SCAN_RANGE,
    host: str = "127.0.0.1",
) -> int:
    """Find the first free port at or after ``start``.

    Binds each candidate port in turn and returns the first one that
    accepts the bind. Probes ``max_tries`` consecutive ports; if none
    are free, raises :class:`OSError`.

    Parameters
    ----------
    start:
        First port to try. Defaults to :data:`DEFAULT_SERVER_PORT`.
    max_tries:
        Number of consecutive ports to probe, inclusive of ``start``.
        Defaults to 50 — enough headroom for a busy developer laptop.
    host:
        Host interface to probe on. Defaults to loopback. Collab mode
        (Layer 4) probes ``"0.0.0.0"`` instead.

    Returns
    -------
    int
        A port number that was free at probe time. There is an
        inherent race — the port might be taken before the caller
        binds — but TOCTOU here just means the caller's
        ``server.start()`` fails with a clean OS error, which is
        better than retrying forever.

    Raises
    ------
    OSError
        When no port in ``[start, start + max_tries)`` is free. The
        message names the probed range so operators can diagnose
        port-exhaustion scenarios.
    """
    last_error: OSError | None = None
    for offset in range(max_tries):
        port = start + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
                # SO_REUSEADDR lets us bind right after a previous
                # server on this port has closed but before its
                # TIME_WAIT expires. Important for rapid test cycles
                # and server restarts.
                sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                sock.bind((host, port))
                return port
        except OSError as exc:
            last_error = exc
            continue
    raise OSError(
        f"No available port in range {start}-{start + max_tries - 1} "
        f"on {host}: {last_error}"
    )


# ---------------------------------------------------------------------------
# Event-loop capture
# ---------------------------------------------------------------------------


class EventLoopHandle:
    """Handle to an asyncio event loop captured on the loop's own thread.

    Used by worker threads (LLM streaming, heavy index builds) to
    schedule callbacks back onto the main event loop via
    :meth:`schedule`. The contract from specs4/3-llm/streaming.md:
    callers MUST capture this on the event-loop thread, and MUST
    NOT re-acquire the loop inside a worker thread.

    The handle is a type-safe wrapper around
    :func:`asyncio.run_coroutine_threadsafe` that makes the capture
    point explicit: anywhere ``EventLoopHandle.capture()`` appears
    in code, the surrounding context is the loop's thread; anywhere
    ``.schedule(...)`` appears, the caller is potentially off-thread.
    """

    __slots__ = ("_loop",)

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    @classmethod
    def capture(cls) -> EventLoopHandle:
        """Capture the currently-running event loop.

        Must be called from inside a coroutine or a callback scheduled
        on the event loop. Calling from a thread that has no running
        loop raises :class:`RuntimeError` (propagated verbatim from
        :func:`asyncio.get_running_loop` — the diagnostic is already
        clear enough that we don't wrap it).
        """
        return cls(asyncio.get_running_loop())

    @property
    def loop(self) -> asyncio.AbstractEventLoop:
        """The captured loop. Exposed for advanced callers; prefer
        :meth:`schedule` for the common case."""
        return self._loop

    def schedule(
        self, coro: Coroutine[Any, Any, Any]
    ) -> concurrent.futures.Future[Any]:
        """Schedule ``coro`` on the captured loop from any thread.

        Thin wrapper around :func:`asyncio.run_coroutine_threadsafe`.
        Returns a :class:`concurrent.futures.Future` — worker threads
        can call ``.result(timeout=...)`` on it to wait for the
        coroutine's result, or fire-and-forget by discarding the
        future.

        Parameters
        ----------
        coro:
            A coroutine object. Typically produced by calling an
            ``async def`` and not awaiting it.
        """
        return asyncio.run_coroutine_threadsafe(coro, self._loop)


# ---------------------------------------------------------------------------
# Service registration facade
# ---------------------------------------------------------------------------


class RpcServer:
    """Composition wrapper around :class:`jrpc_oo.JRPCServer`.

    Exposes only the surface AC-DC needs — ``start``, ``stop``,
    ``add_service`` — and insulates callers from jrpc-oo's internal
    hooks that aren't part of our contract.

    Layer 4's collab admission flow will extend this by overriding
    :meth:`_create_inner_server`, so the subclass can plug in a
    connection-screening subclass of :class:`JRPCServer` without
    touching the rest of :class:`RpcServer`'s API.

    Host binding — the ``host`` argument is currently recorded but
    not passed through to jrpc-oo, which binds to localhost by
    default. Layer 4 will either upgrade jrpc-oo to accept a host
    parameter or subclass :meth:`_create_inner_server` to pass one.
    """

    def __init__(
        self,
        port: int = DEFAULT_SERVER_PORT,
        *,
        host: str = "127.0.0.1",
        remote_timeout: float = DEFAULT_REMOTE_TIMEOUT,
        max_message_size: int = DEFAULT_MAX_MESSAGE_SIZE,
    ) -> None:
        self._port = port
        self._host = host
        self._remote_timeout = remote_timeout
        self._max_message_size = max_message_size
        self._inner: JRPCServer | None = None
        self._started = False

    @property
    def port(self) -> int:
        """The configured port. Stable for the server's lifetime."""
        return self._port

    @property
    def host(self) -> str:
        """The configured host. Recorded for Layer 4 collab use."""
        return self._host

    @property
    def started(self) -> bool:
        """True after :meth:`start` has been awaited successfully."""
        return self._started

    def _create_inner_server(self) -> JRPCServer:
        """Construct the inner :class:`JRPCServer`.

        Factory hook — Layer 4's collab subclass overrides this to
        plug in a connection-screening subclass of JRPCServer. The
        base implementation returns a :class:`MaxSizeJRPCServer`
        that raises the ``websockets`` frame-size limit from the
        1 MiB default to :data:`DEFAULT_MAX_MESSAGE_SIZE` —
        necessary for data-URI image payloads in chat_streaming args.
        """
        return MaxSizeJRPCServer(
            port=self._port,
            remote_timeout=self._remote_timeout,
            max_size=self._max_message_size,
        )

    async def start(self) -> None:
        """Start listening for WebSocket connections.

        Idempotent — calling on an already-started server logs a
        warning and returns. Callers that want to restart a stopped
        server should construct a new :class:`RpcServer`.

        Raises
        ------
        OSError
            If the port is unavailable. Callers should use
            :func:`find_available_port` first.
        """
        if self._started:
            logger.warning(
                "RpcServer.start() on already-started server (port %d); "
                "ignoring.",
                self._port,
            )
            return
        if self._inner is None:
            self._inner = self._create_inner_server()
        await self._inner.start()
        self._started = True
        logger.info("RPC server started on %s:%d", self._host, self._port)

    async def stop(self) -> None:
        """Close the server and any open connections.

        Idempotent — safe to call on a never-started or already-
        stopped server.
        """
        if self._inner is None or not self._started:
            return
        await self._inner.stop()
        self._started = False
        logger.info("RPC server stopped on %s:%d", self._host, self._port)

    def add_service(self, instance: Any, name: str | None = None) -> None:
        """Register a service instance with jrpc-oo.

        Public methods on ``instance`` become callable over RPC as
        ``<Name>.<method>``. By default the namespace is the Python
        class name of ``instance``. Pass ``name`` to override.

        Must be called before :meth:`start` — jrpc-oo sends the
        method list during the handshake, so registrations after
        connection aren't advertised to the remote.

        Parameters
        ----------
        instance:
            Object whose public methods should be exposed. Methods
            starting with ``_`` are filtered out by jrpc-oo's
            :class:`ExposeClass`.
        name:
            Optional namespace. Defaults to
            ``type(instance).__name__``.

        Raises
        ------
        RuntimeError
            If the server has already been started — jrpc-oo's
            method registration isn't safe to mutate mid-session.
        """
        if self._started:
            raise RuntimeError(
                "Cannot add services after RpcServer has started; "
                "register all services before calling start()."
            )
        if self._inner is None:
            self._inner = self._create_inner_server()
        # jrpc-oo's add_class signature is (instance, obj_name=None).
        # Forward ``name`` verbatim so the caller's override wins.
        self._inner.add_class(instance, name)


# ---------------------------------------------------------------------------
# Frame-size-aware JRPCServer subclass
# ---------------------------------------------------------------------------


class MaxSizeJRPCServer(JRPCServer):
    """JRPCServer that raises the ``websockets`` frame-size limit.

    Upstream :meth:`jrpc_oo.JRPCServer.start` hardcodes the
    :func:`websockets.serve` call with no kwarg forwarding, so
    subclassing is the only way to raise the frame-size limit
    without patching jrpc-oo. See :data:`DEFAULT_MAX_MESSAGE_SIZE`
    for the rationale behind the default.
    """

    def __init__(
        self,
        port: int = DEFAULT_SERVER_PORT,
        remote_timeout: int = 60,
        ssl_context: Any = None,
        max_size: int = DEFAULT_MAX_MESSAGE_SIZE,
    ) -> None:
        super().__init__(
            port=port,
            remote_timeout=remote_timeout,
            ssl_context=ssl_context,
        )
        self._max_size = max_size

    async def start(self) -> None:
        self.ws_server = await websockets.serve(
            self.handle_connection,
            "0.0.0.0",
            self.port,
            ssl=self.ssl_context,
            max_size=self._max_size,
        )
        protocol = "WSS" if self.ssl_context else "WS"
        logger.info(
            "JRPC Server started on port %d with %s protocol "
            "(max_size=%d bytes)",
            self.port,
            protocol,
            self._max_size,
        )