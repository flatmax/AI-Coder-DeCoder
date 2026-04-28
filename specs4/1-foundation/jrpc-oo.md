# Guide: Setting Up jrpc-oo (Browser ↔ Server RPC over WebSockets)

## What it is

**jrpc-oo** is a JSON-RPC library that lets a browser client call methods on a Python (or Node) server over WebSockets. You expose objects on the server; their public methods automatically become callable from the browser.

---

## 1. Install

**Python server:**
```toml
# In your pyproject.toml
dependencies = [
    "jrpc-oo @ git+https://github.com/flatmax/jrpc-oo.git",
]
```

**Browser/Node client:**
```bash
npm install @flatmax/jrpc-oo
```

> **Important — import path:**  `@flatmax/jrpc-oo` ships a UMD bundle
> that assigns a global (`JRPC`).  Importing via the package root
> or via `jrpc-client.js` can trigger bundler quirks (esbuild dep
> pre-bundling in dev, Rollup CJS-emulation in prod) that produce
> `Uncaught ReferenceError: JRPC is not defined` at runtime.
>
> Import via the **explicit bundle path** instead:
>
> ```js
> import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';
> ```
>
> With this import, no special Vite config is required — no
> `optimizeDeps.exclude` entry, no Rollup source-rewrite plugin.
> If imports fail after an upstream version bump, clear the dev cache:
> ```bash
> rm -rf node_modules/.vite
> ```

---

## 2. Server (Python)

The port is passed to the `JRPCServer` constructor. `add_class()` exposes all
public methods on the given object. The server is started with `await server.start()`.

```python
import asyncio
from jrpc_oo import JRPCServer

class MyService:
    def hello(self, name="world"):
        return f"Hello, {name}!"

    def add(self, a, b):
        return a + b

async def main():
    port = 9001
    server = JRPCServer(port, remote_timeout=60)
    server.add_class(MyService())  # all public methods become RPC endpoints
    await server.start()           # listens on ws://localhost:9001

    # Keep the server running until interrupted
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("Shutting down…")

asyncio.run(main())
```

Every public method on objects passed to `add_class()` is auto-discovered and exposed.

---

## 3. Browser Client

The client is a LitElement custom element. You create it, set the `serverURI`, append it to the DOM (which triggers the WebSocket connection), and use `setupDone` to know when it's ready.

```javascript
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';

class MyClient extends JRPCClient {
    connectedCallback() {
        super.connectedCallback();
        this.addClass(this, 'MyClient');  // register methods for server→browser calls
    }

    setupDone() {
        super.setupDone();
        // Connection is ready — remote methods are now callable
    }
}

// Register as a custom element
customElements.define('my-client', MyClient);
```

### Connecting and calling methods:

```javascript
const client = document.createElement('my-client');
client.serverURI = 'ws://localhost:9001';

client.setupDone = async () => {
    // Call remote methods using this['methodName'](args)
    // .values() unwraps the JRPC response envelope
    const greeting = (await client['hello']('Alice')).values();
    const sum = (await client['add'](2, 3)).values();
};

document.body.appendChild(client);  // triggers WS connection
```

### Key patterns:

- **`this['methodName'](args)`** — calls the remote server method
- **`.values()`** — unwraps the result from the JRPC response envelope
- **Appending to DOM** triggers the connection
- **`setupDone()`** fires when the handshake completes and methods are available
- **`remoteDisconnected(uuid)`** callback fires if the server drops

---

## 4. Choosing the WebSocket Port

A common pattern is reading the port from environment or URL params:

```javascript
function getWsPort(defaultPort = 9001) {
    const params = new URLSearchParams(window.location.search);
    return parseInt(params.get('port') || defaultPort);
}

client.serverURI = `ws://localhost:${getWsPort()}`;
```

---

## 5. Auto-Finding an Available Port

If your default port is already in use, scan for the next available one:

```python
import socket

def find_available_port(start=9001, max_tries=50):
    """Try binding to localhost ports starting from `start`.
    Returns the first available port.
    """
    for offset in range(max_tries):
        port = start + offset
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(("127.0.0.1", port))
                return port
        except OSError:
            continue
    raise RuntimeError(f"No available port in range {start}-{start + max_tries - 1}")
```

Use it when starting your server:

```python
async def main():
    port = find_available_port(9001)

    server = JRPCServer(port, remote_timeout=60)
    server.add_class(MyService())
    await server.start()

    print(f"Server running on ws://localhost:{port}")

    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("Shutting down…")
```

Then pass the chosen port to the browser so it knows where to connect (see §6 below).

---

## 6. Auto-Opening the Browser

Once the server is listening, open the webapp and pass the WebSocket port as a query parameter:

```python
import webbrowser

async def main():
    port = find_available_port(9001)
    webapp_port = 5173  # Vite dev server port

    server = JRPCServer(port, remote_timeout=60)
    server.add_class(MyService())
    await server.start()

    # Open browser with the WS port in the URL
    url = f"http://localhost:{webapp_port}/?port={port}"
    webbrowser.open(url)

    # Keep the server running
    try:
        await asyncio.Event().wait()
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("Shutting down…")
```

The browser-side JavaScript reads the port from the URL (see §4) and connects the WebSocket to it.

**The full startup sequence is:**

1. Find an available port for the WebSocket server
2. Create the server with `JRPCServer(port, remote_timeout=60)`
3. Register service classes with `server.add_class(obj)`
4. Start the server with `await server.start()`
5. Open the browser pointing at the webapp, with `?port=N` in the URL
6. `await asyncio.Event().wait()` to keep the process alive

**Shutdown:** handle `SIGINT`/`SIGTERM` to clean up child processes (e.g. a Vite dev server), then exit:

```python
import signal, sys

def _signal_handler(sig, frame):
    sys.exit(0)

signal.signal(signal.SIGINT, _signal_handler)
signal.signal(signal.SIGTERM, _signal_handler)
```

---

## 7. This Project's Implementation

The implementation lives in two places:

### Server: `server/main.py`

```bash
pxie-server                          # auto-find WS port, start Vite, open browser
pxie-server --ws-port 9001           # explicit WS port
pxie-server --webapp-port 3000       # custom Vite port
pxie-server --no-browser             # don't auto-open browser
```

The server:
1. Finds an available WebSocket port (default: scan from 9001)
2. Creates `JRPCServer(port, remote_timeout=60)` and starts it
3. Launches `npx vite` in `webapp/` as a child process
4. Opens the browser at `http://localhost:{vite_port}/?port={ws_port}`
5. Waits on `asyncio.Event().wait()` until interrupted
6. SIGINT/SIGTERM handler terminates the Vite child process

### Client: `webapp/src/pxie-rpc.js`

A `JRPCClient` subclass registered as `<pxie-rpc>`:
- `connectedCallback()` calls `this.addClass(this, 'PxieRpc')`
- `setupDone()` resolves a `this.ready` promise and dispatches `rpc-connected`
- `remoteDisconnected()` dispatches `rpc-disconnected`
- Other components get a reference and call `(await rpc['method'](args)).values()`

### App shell: `webapp/src/pxie-app.js`

A Lit component `<pxie-app>` that:
- Reads `?port=` from the URL via `URLSearchParams`
- Sets `rpc.serverURI` in `firstUpdated()`
- Listens for `rpc-connected` / `rpc-disconnected` events
- Shows a status badge (connecting → connected → disconnected)

### Dependencies

**Python** (`pyproject.toml`):
```toml
"jrpc-oo @ git+https://github.com/flatmax/jrpc-oo.git"
```

**npm** (`webapp/package.json`):
```json
"@flatmax/jrpc-oo": "^1.2.2",
"lit": "^3.2.0"
```

### Vite Configuration

`@flatmax/jrpc-oo` ships a UMD bundle that exposes a browser global
(`JRPC`) and also includes CJS branch code (`typeof module !==
'undefined'`, `require('crypto')`). Different import paths trigger
different bundler behaviour:

- **Package root** (`import ... from '@flatmax/jrpc-oo'`) — resolves
  through `package.json` exports/main, which in dev pulls esbuild
  pre-bundling and in prod pulls Rollup's CJS-emulation shim. Either
  path can make the UMD take the wrong branch, producing
  `Uncaught ReferenceError: JRPC is not defined`.
- **Explicit bundle path** (`import ... from
  '@flatmax/jrpc-oo/dist/bundle.js'`) — skipped by pre-bundling and
  handled as plain ESM by both dev server and Rollup. No special
  config needed.

**Recommendation:** always import via the explicit bundle path:

```js
import { JRPCClient } from '@flatmax/jrpc-oo/dist/bundle.js';
```

No `optimizeDeps.exclude` entry, Rollup plugin, or alias is required.
If imports start failing after an upstream version bump, flush the dev
cache:

```bash
rm -rf node_modules/.vite
```

---

## Calling Server Methods from the Browser Client

### The Setup Flow

When jrpc-oo connects, the server and client **exchange their registered class.method names** automatically via `system.listComponents`. After `setupDone()` fires, both sides know what the other side exposes.

### Server Side (Python)

```python
from jrpc_oo import JRPCServer

class MyApi:
    def get_data(self, query):
        return {"results": [1, 2, 3], "query": query}
    
    def add(self, a, b):
        return a + b

server = JRPCServer(port=8765)
server.add_class(MyApi(), 'MyApi')
await server.start()
```

This registers `MyApi.get_data` and `MyApi.add` as callable methods.

### Browser Side — Two Ways to Call Server Methods

There are **two calling mechanisms**: `this.server` and `this.call`. They have different response formats.

---

#### 1. `this.server['ClassName.method_name'](args)` — Single Remote

This calls **one** remote. It returns a **Promise that resolves directly to the result value**.

Under the hood in `JRPCCommon.js` `setupFns()`:

```js
this.server[fnName] = function (params) {
    return new Promise((resolve, reject) => {
        remote.call(fnName, {args : Array.from(arguments)}, (err, result) => {
            if (err) reject(err);
            else resolve(result);
        });
    });
};
```

Usage:

```js
this.server['MyApi.get_data']({query: 'test'}).then((result) => {
    // result IS the return value directly — e.g. {"results": [1,2,3], "query": "test"}
    console.log(result);
}).catch((err) => {
    console.error(err);
});
```

**⚠️ Caveat:** if two remotes expose the same method name, `this.server[fnName]` gets replaced with an error function that rejects with `"More than one remote has this RPC, not sure who to talk to"`. This is the legacy API.

---

#### 2. `this.call['ClassName.method_name'](args)` — All Remotes (Recommended)

This calls **every connected remote** that has that method. It returns a **Promise that resolves to an object keyed by UUID**.

Under the hood in `JRPCCommon.js` `setupFns()`:

```js
this.call[fnName] = (...args) => {
    let promises = [];
    let rems = [];
    for (const remote in this.remotes) {
        if (this.remotes[remote].rpcs[fnName] != null) {
            rems.push(remote);
            promises.push(this.remotes[remote].rpcs[fnName](...args));
        }
    }
    return Promise.all(promises).then((data) => {
        let p = {};
        rems.forEach((v, n) => p[v] = data[n]);
        return p;
    });
}
```

So the response shape is:

```js
this.call['MyApi.get_data']({query: 'test'}).then((result) => {
    // result is: { "uuid-of-server-1": {results: [1,2,3], query: "test"} }
    // If multiple remotes had this method, each UUID is a key:
    // { "uuid-1": <result1>, "uuid-2": <result2> }
    
    // To get the single server's result:
    let firstResult = Object.values(result)[0];
    console.log(firstResult);
}).catch((err) => {
    console.error(err);
});
```

**Yes — `this.call` returns `{ uuid: responseValue }` as the resolved Promise value.**

---

### Response Format Summary

| Mechanism | Calls | Response Shape | Safe with multiple remotes? |
|---|---|---|---|
| `this.server['Cls.method'](args)` | One remote | Direct result value | ❌ Errors if ambiguous |
| `this.call['Cls.method'](args)` | All remotes | `{ uuid: result, ... }` | ✅ Yes |

### Arguments — How They Arrive on the Server

When you call `this.server['MyApi.add'](3, 5)`, the JS side wraps arguments as:
```json
{"args": [3, 5]}
```

This is sent as a JSON-RPC 2.0 `params` field. On the Python side, `ExposeClass` unwraps this — your Python method receives them as normal parameters: `def add(self, a, b)`.

### Typical Component Pattern

```js
class MyComponent extends JRPCClient {
    setupDone() {
        super.setupDone();
        console.log('Available methods:', Object.keys(this.server));
        this.loadInitialData();
    }

    loadInitialData() {
        // Using this.server (direct result):
        this.server['MyApi.get_data']({query: 'initial'}).then((result) => {
            this.data = result;  // the actual return value
            this.requestUpdate();
        });

        // OR using this.call (uuid-keyed result):
        this.call['MyApi.get_data']({query: 'initial'}).then((result) => {
            this.data = Object.values(result)[0];  // unwrap from UUID key
            this.requestUpdate();
        });
    }
}
```

### Registering Client Methods (Server → Browser Calls)

`this.addClass(this, 'MyComponent')` registers methods that the **server** can call **on the client** — it's the reverse direction. Only needed if the server needs to push calls to the browser.

### Debugging Tip

Log `Object.keys(this.server)` and `Object.keys(this.call)` inside `setupDone()` to see exactly which server methods are available — the names must match exactly (case-sensitive, dot-separated).

---

## Summary

| Piece | What to do |
|-------|-----------|
| **Python server** | `JRPCServer(port, remote_timeout=60)`, call `add_class(obj)`, then `await server.start()` |
| **Browser client** | Extend `JRPCClient`, register as custom element, set `serverURI`, append to DOM |
| **Port finding** | Bind-test ports starting from a default; pass the chosen port to the browser via `?port=N` |
| **Auto-open browser** | `webbrowser.open(url)` after `await server.start()` |
| **Calling methods (single)** | `this.server['ClassName.method'](args).then(result => ...)` — resolves to direct value |
| **Calling methods (all remotes)** | `this.call['ClassName.method'](args).then(result => ...)` — resolves to `{uuid: value}` |
| **Lifecycle** | `setupDone()` = connected and ready; `remoteDisconnected(uuid)` = server gone |
| **Keep alive** | `await asyncio.Event().wait()` after starting the server; handle `SIGINT`/`SIGTERM` for clean shutdown |
| **Import path** | Use `@flatmax/jrpc-oo/dist/bundle.js` — no Vite config needed |