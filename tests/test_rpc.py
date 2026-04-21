"""Tests for ac_dc.rpc — Layer 1.4.

Scope:

- find_available_port — port scanning, host binding, exhaustion
- EventLoopHandle — capture on the loop thread, schedule from workers
- RpcServer — lifecycle (start/stop), idempotence, service registration,
  and the collab factory hook

jrpc-oo tests happen at the integration layer (the library is already
tested upstream). Here we focus on our wrapper's invariants: that it
enforces the documented ordering (add_service before start), that it
delegates to the inner server correctly, and that its factory hook
produces a subclass-friendly seam for Layer 4.
"""

from __future__ import annotations

import asyncio
import socket
import threading
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from ac_dc.rpc import (
    DEFAULT_REMOTE_TIMEOUT,
    DEFAULT_SERVER_PORT,
    EventLoopHandle,
    RpcServer,
    find_available_port,
)


# ---------------------------------------------------------------------------
# Test-only service for the round-trip test
# ---------------------------------------------------------------------------


class _EchoService:
    """Minimal service used by the round-trip integration test.

    Two methods so we can verify both no-arg and multi-arg calls
    route correctly, plus a private method to prove jrpc-oo's
    underscore-prefix filter is in effect (private methods must
    not be RPC-callable).
    """

    def echo(self, value: str) -> str:
        """Return the argument verbatim."""
        return value

    def add(self, a: int, b: int) -> int:
        """Return a + b. Tests multi-arg dispatch."""
        return a + b

    def _secret(self) -> str:  # noqa: D401 — test fixture
        """Private method — must NOT be exposed over RPC."""
        return "should-not-be-reachable"


# ---------------------------------------------------------------------------
# find_available_port
# ---------------------------------------------------------------------------


class TestFindAvailablePort:
    """Port scanner — returns the first free port in the probed range."""

    def test_returns_start_port_when_free(self) -> None:
        """The first free port in the range is returned.

        We can't know which ports are free on the test machine, so
        we ask the OS for an ephemeral port, close it, and pass
        that as the start. There's a small race window where
        something else could grab the port — acceptable for a
        test of the happy path.
        """
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.bind(("127.0.0.1", 0))
            free_port = probe.getsockname()[1]
        assert find_available_port(start=free_port, max_tries=1) == free_port

    def test_skips_occupied_port(self) -> None:
        """When ``start`` is bound, the scanner tries ``start + 1``."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s1:
            s1.bind(("127.0.0.1", 0))
            port = s1.getsockname()[1]
            s1.listen(1)
            # Scanner starts at `port` (occupied); must return a
            # different, higher port.
            result = find_available_port(start=port, max_tries=50)
            assert result != port
            assert result > port

    def test_raises_when_range_exhausted(self) -> None:
        """max_tries=1 on an occupied port raises OSError."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.listen(1)
            with pytest.raises(OSError, match="No available port"):
                find_available_port(start=port, max_tries=1)

    def test_error_message_names_the_range(self) -> None:
        """Diagnostic includes the probed port range so operators
        can see where exhaustion happened."""
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
            sock.listen(1)
            try:
                find_available_port(start=port, max_tries=1)
            except OSError as exc:
                message = str(exc)
            else:
                pytest.fail("expected OSError")
            assert str(port) in message

    def test_default_port_constant(self) -> None:
        """DEFAULT_SERVER_PORT matches the CLI default (18080)."""
        assert DEFAULT_SERVER_PORT == 18080

    def test_default_remote_timeout_constant(self) -> None:
        """DEFAULT_REMOTE_TIMEOUT matches the spec's 120s figure."""
        assert DEFAULT_REMOTE_TIMEOUT == 120.0

    def test_invalid_host_raises(self) -> None:
        """An unresolvable host surfaces as OSError, not silent skip."""
        with pytest.raises(OSError):
            find_available_port(
                start=DEFAULT_SERVER_PORT,
                max_tries=1,
                host="this-is-not-a-valid-host-name",
            )


# ---------------------------------------------------------------------------
# EventLoopHandle
# ---------------------------------------------------------------------------


class TestEventLoopHandle:
    """Capture-at-entry loop handle — the specs4 streaming contract."""

    async def test_capture_returns_handle(self) -> None:
        """capture() inside a coroutine yields a handle with the loop."""
        handle = EventLoopHandle.capture()
        assert isinstance(handle, EventLoopHandle)
        assert handle.loop is asyncio.get_running_loop()

    def test_capture_outside_loop_raises(self) -> None:
        """capture() with no running loop raises RuntimeError.

        Matches :func:`asyncio.get_running_loop` semantics. Verifies
        the error is propagated verbatim rather than swallowed.
        """
        with pytest.raises(RuntimeError):
            EventLoopHandle.capture()

    async def test_schedule_runs_coroutine_on_captured_loop(self) -> None:
        """A coroutine scheduled from a worker thread runs on the loop.

        This is the core contract — capture on the loop thread,
        schedule from elsewhere. We verify by stashing the thread
        identity inside the scheduled coroutine and confirming it
        matches the loop's own thread ID (not the worker's).
        """
        handle = EventLoopHandle.capture()
        loop_thread_id = threading.get_ident()
        observed: dict[str, int] = {}

        async def record_thread() -> str:
            observed["ran_on"] = threading.get_ident()
            return "done"

        # Schedule from a worker thread.
        def worker() -> None:
            future = handle.schedule(record_thread())
            observed["result"] = future.result(timeout=5.0)
            observed["worker_was"] = threading.get_ident()

        thread = threading.Thread(target=worker)
        thread.start()
        # Spin the loop while the worker runs. Short sleeps yield
        # the loop so the scheduled coroutine can execute.
        while thread.is_alive():
            await asyncio.sleep(0.01)
        thread.join(timeout=5.0)

        assert observed["result"] == "done"
        # Coroutine ran on the loop's thread, not the worker's.
        assert observed["ran_on"] == loop_thread_id
        assert observed["worker_was"] != loop_thread_id


# ---------------------------------------------------------------------------
# RpcServer
# ---------------------------------------------------------------------------


def _mock_inner() -> MagicMock:
    """Build a MagicMock standing in for a JRPCServer instance.

    ``start`` and ``stop`` are the async methods the wrapper awaits.
    ``add_class`` is sync. Everything else defaults to MagicMock
    behaviour, which is fine — the wrapper doesn't touch it.
    """
    inner = MagicMock()
    inner.start = AsyncMock()
    inner.stop = AsyncMock()
    inner.add_class = MagicMock()
    return inner


class _StubRpcServer(RpcServer):
    """Test subclass that injects a mock inner server.

    Mirrors how Layer 4's collab subclass will override the factory
    — proves the hook is usable for its stated purpose.
    """

    def __init__(self, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self.mock_inner = _mock_inner()
        self.factory_calls = 0

    def _create_inner_server(self) -> Any:
        self.factory_calls += 1
        return self.mock_inner


class TestRpcServerConstruction:
    """Constructor and property accessors."""

    def test_defaults_match_module_constants(self) -> None:
        """Constructor defaults use the module-level constants."""
        server = RpcServer()
        assert server.port == DEFAULT_SERVER_PORT
        assert server.host == "127.0.0.1"
        assert server.started is False

    def test_explicit_args_override_defaults(self) -> None:
        """Port, host, and timeout are all settable."""
        server = RpcServer(
            port=19000,
            host="0.0.0.0",
            remote_timeout=30.0,
        )
        assert server.port == 19000
        assert server.host == "0.0.0.0"
        assert server.started is False


class TestRpcServerLifecycle:
    """start / stop — idempotence, flag transitions, factory hook."""

    async def test_start_calls_inner_start(self) -> None:
        """start() awaits the inner server's start() and flips flag."""
        server = _StubRpcServer()
        await server.start()
        assert server.started is True
        server.mock_inner.start.assert_awaited_once()

    async def test_start_lazy_constructs_inner(self) -> None:
        """Inner server is built via the factory hook on first use."""
        server = _StubRpcServer()
        assert server.factory_calls == 0
        await server.start()
        assert server.factory_calls == 1

    async def test_start_is_idempotent(self) -> None:
        """Starting twice doesn't re-invoke the inner's start()."""
        server = _StubRpcServer()
        await server.start()
        await server.start()
        # Inner's start was awaited exactly once.
        assert server.mock_inner.start.await_count == 1

    async def test_stop_calls_inner_stop(self) -> None:
        """stop() on a started server awaits the inner's stop()."""
        server = _StubRpcServer()
        await server.start()
        await server.stop()
        assert server.started is False
        server.mock_inner.stop.assert_awaited_once()

    async def test_stop_without_start_is_noop(self) -> None:
        """Calling stop on a never-started server is safe."""
        server = _StubRpcServer()
        await server.stop()
        # Inner was never built, never called.
        assert server.factory_calls == 0
        server.mock_inner.stop.assert_not_awaited()

    async def test_stop_twice_is_idempotent(self) -> None:
        """Stopping an already-stopped server is a no-op."""
        server = _StubRpcServer()
        await server.start()
        await server.stop()
        await server.stop()
        # Inner's stop was awaited exactly once.
        assert server.mock_inner.stop.await_count == 1


class TestRpcServerAddService:
    """add_service — namespace defaulting, ordering enforcement."""

    def test_add_service_lazy_constructs_inner(self) -> None:
        """First add_service builds the inner server via factory."""
        server = _StubRpcServer()
        assert server.factory_calls == 0
        server.add_service(object())
        assert server.factory_calls == 1

    def test_add_service_reuses_inner_after_first_call(self) -> None:
        """Subsequent add_service calls don't rebuild the inner."""
        server = _StubRpcServer()
        server.add_service(object())
        server.add_service(object())
        assert server.factory_calls == 1

    def test_add_service_delegates_to_inner(self) -> None:
        """The call forwards instance and name to inner.add_class."""
        server = _StubRpcServer()
        instance = object()
        server.add_service(instance, name="MyService")
        server.mock_inner.add_class.assert_called_once_with(
            instance, "MyService"
        )

    def test_add_service_default_name_is_none(self) -> None:
        """Omitted ``name`` is forwarded as None, letting jrpc-oo
        derive the namespace from the instance's class name."""
        server = _StubRpcServer()
        instance = object()
        server.add_service(instance)
        server.mock_inner.add_class.assert_called_once_with(instance, None)

    async def test_add_service_rejected_after_start(self) -> None:
        """Cannot register services once the server is started.

        jrpc-oo advertises the method list during the handshake;
        registering after connection would mean clients never see
        the new methods. The wrapper rejects this with a clear
        RuntimeError rather than letting the registration
        silently fail to propagate.
        """
        server = _StubRpcServer()
        await server.start()
        with pytest.raises(RuntimeError, match="after RpcServer has started"):
            server.add_service(object())

    async def test_add_service_allowed_after_stop(self) -> None:
        """After stop(), the server is no longer 'started' — a
        fresh registration cycle could begin before a future
        start(). Verified for completeness even though the wrapper
        itself doesn't support re-start."""
        server = _StubRpcServer()
        await server.start()
        await server.stop()
        # Does not raise.
        server.add_service(object())


class TestRpcServerFactoryHook:
    """The _create_inner_server seam is the contract for Layer 4.

    These tests pin the hook's shape so the collab subclass can
    depend on it: a subclass overriding _create_inner_server is
    invoked on first-use (start or add_service), and its return
    value becomes the wrapper's inner server.
    """

    async def test_subclass_override_is_used(self) -> None:
        """A subclass's _create_inner_server return value is used."""
        server = _StubRpcServer()
        await server.start()
        # The stub's factory was called, not the base class's
        # (which would have tried to import jrpc_oo).
        assert server.factory_calls == 1
        # And the returned mock received the start call.
        server.mock_inner.start.assert_awaited_once()

    async def test_factory_called_exactly_once_across_lifecycle(self) -> None:
        """Factory is called once; subsequent operations reuse it.

        Confirms the "cache the inner" invariant: add_service ->
        start -> stop -> add_service goes through the factory
        exactly once. Important for collab's subclass, which may
        do non-trivial work (allocating admission state, opening
        log files) in _create_inner_server.
        """
        server = _StubRpcServer()
        server.add_service(object())
        await server.start()
        await server.stop()
        server.add_service(object())
        assert server.factory_calls == 1


# ---------------------------------------------------------------------------
# Round-trip integration
# ---------------------------------------------------------------------------


class TestRpcServerRoundTrip:
    """End-to-end smoke test — real JRPCServer + real JRPCClient.

    The other test classes use mocks to pin down our wrapper's
    contract. This class proves the wrapper integrates correctly
    with the actual jrpc-oo library — catches signature mismatches,
    event-loop handling quirks, and any other behavior that only
    surfaces at the library boundary.

    Uses jrpc-oo's ``setup_done`` override hook rather than polling
    ``client.server``: ``server`` is a proxy object whose membership
    semantics aren't documented for the ``in`` operator, and the
    handshake is asynchronous. The hook is jrpc-oo's documented
    signal that remote methods are callable.
    """

    async def test_client_can_call_registered_method(self) -> None:
        """A Python client calling our server over WebSocket works.

        This is an integration test that exercises the full jrpc-oo
        stack. Each step has a tight timeout so a hang in any one
        phase produces a clear diagnostic rather than wedging pytest.

        Diagnostic prints (captured by pytest under ``-s``) let us
        see exactly which phase hung if the bounded timeouts are
        hit. Leave them in — they help future debugging too.
        """
        # Imported lazily here so the rest of the test file doesn't
        # pay the jrpc-oo import cost — many tests above don't need it.
        from jrpc_oo import JRPCClient

        class _ReadyClient(JRPCClient):
            """Client that signals when the handshake is complete."""

            def __init__(self, server_uri: str) -> None:
                super().__init__(server_uri=server_uri)
                self.ready = asyncio.Event()

            def setup_done(self) -> None:  # noqa: D401 — jrpc-oo hook
                print("  [client] setup_done fired")
                super().setup_done()
                self.ready.set()

            def remote_is_up(self) -> None:  # noqa: D401 — jrpc-oo hook
                print("  [client] remote_is_up fired")
                super().remote_is_up()

            def setup_skip(self) -> None:  # noqa: D401 — jrpc-oo hook
                print("  [client] setup_skip fired (connection failed)")
                super().setup_skip()
                # If setup_skip fires we'll never see setup_done —
                # set the event anyway so the test fails with a
                # clearer assertion rather than timing out.
                self.ready.set()

        port = find_available_port(start=19000, max_tries=50)
        print(f"\n  [test] using port {port}")

        server = RpcServer(port=port)
        server.add_service(_EchoService(), name="EchoService")
        print("  [test] starting server...")
        await asyncio.wait_for(server.start(), timeout=3.0)
        print("  [test] server started")

        client = _ReadyClient(server_uri=f"ws://127.0.0.1:{port}")
        # jrpc-oo's JRPCClient.connect() runs the WebSocket message
        # receive loop inline — it does NOT return until the socket
        # closes. So we launch it as a background task and wait for
        # the ``setup_done`` hook to fire instead of awaiting the
        # coroutine directly.
        connect_task = asyncio.create_task(client.connect())
        try:
            print("  [test] waiting for setup_done...")
            await asyncio.wait_for(client.ready.wait(), timeout=5.0)
            print("  [test] handshake complete; making call...")

            # Single-arg call. Wrap in wait_for so a hung RPC also
            # surfaces as a timeout rather than blocking forever.
            echo_result = await asyncio.wait_for(
                client.server["EchoService.echo"]("hello"),
                timeout=3.0,
            )
            print(f"  [test] echo returned: {echo_result!r}")
            assert echo_result == "hello"

            # Multi-arg call.
            add_result = await asyncio.wait_for(
                client.server["EchoService.add"](2, 3),
                timeout=3.0,
            )
            print(f"  [test] add returned: {add_result!r}")
            assert add_result == 5
        finally:
            print("  [test] cleaning up...")
            # Disconnect closes the WebSocket, which ends the
            # message loop inside the connect task. Cancel the
            # task as a belt-and-braces measure in case
            # disconnect races with a still-pending frame.
            try:
                await asyncio.wait_for(client.disconnect(), timeout=2.0)
            except asyncio.TimeoutError:
                print("  [test] client.disconnect timed out")
            connect_task.cancel()
            try:
                await asyncio.wait_for(connect_task, timeout=2.0)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                pass
            try:
                await asyncio.wait_for(server.stop(), timeout=2.0)
            except asyncio.TimeoutError:
                print("  [test] server.stop timed out")
            print("  [test] cleanup done")