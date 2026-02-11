# jrpc-oo Integration

## Overview

[jrpc-oo](https://github.com/flatmax/jrpc-oo) provides bidirectional JSON-RPC 2.0 over WebSocket. Either side can call methods on the other. This guide covers the setup and calling patterns.

## Server Side (Python)

### Setup

```python
from jrpc_oo import JRPCServer

server = JRPCServer(port, remote_timeout=60)
server.add_class(my_service)   # pass an instance, not a class
await server.start()
```

`add_class()` introspects the instance and exposes all public methods as `ClassName.method_name` RPC endpoints.

### Exposing Methods

No base class or decorator needed. Public methods are exposed; underscore-prefixed methods are not.

```python
class MyService:
    def do_something(self, arg1: str, arg2: int = 0) -> dict:
        return {"result": "ok"}       # → callable as MyService.do_something

    def _internal(self):
        ...                            # NOT exposed
```

Arguments and return values must be JSON-serializable (dicts, lists, strings, numbers, booleans, None).

### Calling the Browser from Python

jrpc-oo injects `get_call()` on registered instances. The returned proxy uses bracket notation:

```python
class MyService:
    @property
    def call(self):
        try:
            return self.get_call()
        except Exception:
            return None

    async def _notify_browser(self, data):
        await self.call["BrowserClass.on_event"](data)
```

The call returns a coroutine. Use `asyncio.wait_for` for timeouts. From a background thread, use `asyncio.run_coroutine_threadsafe` to schedule the call on the event loop.

### Response Envelope

All jrpc-oo return values are wrapped: `{ "remote_id": return_value }`. To read the actual value, extract from the remote id key:

```python
raw = await self.call["BrowserClass.get_data"]()
# raw = { "remote_id": {"items": [...]} }
data = raw["remote_id"]
# data = {"items": [...]}
```

In practice, many server→browser calls are fire-and-forget notifications where the browser returns `true` as an acknowledgement and the Python side just awaits without inspecting the result.

## Browser Side (JavaScript)

### Root Component

The root component extends `JRPCClient` (which extends `LitElement`), giving it WebSocket transport and the `call` proxy:

```javascript
import { JRPCClient } from '@flatmax/jrpc-oo';

class MyApp extends JRPCClient {
    constructor() {
        super();
        this.serverURI = `ws://localhost:${port}`;
        this.remoteTimeout = 60;
    }

    connectedCallback() {
        super.connectedCallback();
        this.addClass(this, 'MyApp');   // register methods the server can call
    }
}
```

### Registering Methods for the Server to Call

`this.addClass(instance, 'Name')` exposes the instance's methods under `Name.*`. Methods must return a value so the server's `await` resolves:

```javascript
class MyApp extends JRPCClient {
    onServerEvent(data) {
        // server calls this as MyApp.onServerEvent
        this._handleEvent(data);
        return true;
    }
}
```

### Connection Lifecycle

Override these `JRPCClient` callbacks:

```javascript
setupDone()          // connected — this.call is ready
setupSkip()          // connection failed
remoteDisconnected() // server went away
```

### Calling Server Methods

After `setupDone()`, use bracket notation on `this.call`:

```javascript
const raw = await this.call['MyService.do_something']('hello', 42);
// raw = { "do_something": { "result": "ok" } }   ← envelope
```

### Unwrapping the Envelope

Write a helper to strip the single-key wrapper:

```javascript
async _extract(method, ...args) {
    const result = await this.call[method](...args);
    if (result && typeof result === 'object') {
        const keys = Object.keys(result);
        if (keys.length === 1) return result[keys[0]];
    }
    return result;
}

const data = await this._extract('MyService.do_something', 'hello', 42);
// data = { "result": "ok" }   ← unwrapped
```

### serverURI changes

A top level change to serverURI should trigger all classes which inherit from JRPC-OO to reset their. When serverURI is set, the JRPCClient tries to reconnect to that new serverURI