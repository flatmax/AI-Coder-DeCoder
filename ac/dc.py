import argparse
import asyncio
import os
import webbrowser
from concurrent.futures import ThreadPoolExecutor

from jrpc_oo import JRPCServer
from ac.llm import LiteLLM
from ac.repo import Repo
from ac.port_utils import find_available_port
from ac.version import get_git_sha, get_webapp_base_url
from ac.webapp_server import start_npm_dev_server


def parse_args():
    parser = argparse.ArgumentParser(description='AC-DC: AI Coder / DeCoder')
    parser.add_argument('--server-port', type=int, default=18080,
                        help='JRPC server port (default: 18080)')
    parser.add_argument('--webapp-port', type=int, default=18999,
                        help='Webapp port for local dev server (default: 18999, only used with --dev)')
    parser.add_argument('--no-browser', action='store_true',
                        help='Do not open browser automatically')
    parser.add_argument('--repo-path', type=str, default=None,
                        help='Path to git repository (default: current directory)')
    parser.add_argument('--dev', action='store_true',
                        help='Run local Vite dev server instead of using hosted webapp')
    parser.add_argument('--preview', action='store_true',
                        help='Build and run local preview server (for testing production builds)')
    return parser.parse_args()


def get_browser_url(server_port, webapp_port=None, dev_mode=False):
    """Construct the browser URL for the webapp.
    
    In dev/preview mode: use local server
    Otherwise: use GitHub Pages with version matching
    """
    if dev_mode:
        return f"http://localhost:{webapp_port}/?port={server_port}"
    
    base_url = get_webapp_base_url()
    sha = get_git_sha(short=True)
    
    if sha:
        # Use SHA-specific version for exact match
        return f"{base_url}/{sha}/?port={server_port}"
    else:
        # Fallback to root (which redirects to latest via JS)
        return f"{base_url}/?port={server_port}"


def open_browser(server_port, webapp_port=None, dev_mode=False):
    url = get_browser_url(server_port, webapp_port, dev_mode)
    webbrowser.open(url)


async def find_ports_async(server_start_port, webapp_start_port):
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as executor:
        server_port_future = loop.run_in_executor(executor, find_available_port, server_start_port)
        webapp_port_future = loop.run_in_executor(executor, find_available_port, webapp_start_port)
        actual_server_port = await server_port_future
        actual_webapp_port = await webapp_port_future
    return actual_server_port, actual_webapp_port


async def main_starter_async(args):
    local_mode = args.dev or args.preview
    
    # Only need webapp port if running locally
    if local_mode:
        actual_server_port, actual_webapp_port = await find_ports_async(args.server_port, args.webapp_port)
    else:
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor() as executor:
            actual_server_port = await loop.run_in_executor(executor, find_available_port, args.server_port)
        actual_webapp_port = None

    print(f"Server port: {actual_server_port}")
    print(f"WebSocket URI: ws://localhost:{actual_server_port}")
    print(f"Browser URL: {get_browser_url(actual_server_port, actual_webapp_port, local_mode)}")
    if args.dev:
        print(f"Webapp port: {actual_webapp_port}")
        print("Dev mode: running local Vite dev server")
    elif args.preview:
        print(f"Webapp port: {actual_webapp_port}")
        print("Preview mode: building and running local preview server")

    repo = Repo(args.repo_path)
    
    server = JRPCServer(port=actual_server_port)
    server.add_class(repo)
    llm = LiteLLM(repo=repo)
    llm.server = server  # Give LiteLLM access to server for callbacks
    server.add_class(llm)

    if local_mode:
        webapp_dir = os.path.join(os.path.dirname(__file__), '..', 'webapp')
        loop = asyncio.get_event_loop()
        # preview mode builds first, dev mode just runs start
        await loop.run_in_executor(None, start_npm_dev_server, webapp_dir, actual_webapp_port, args.preview)

    print('starting server...')
    await server.start()

    if not args.no_browser:
        open_browser(actual_server_port, actual_webapp_port, local_mode)

    # Keep the server running
    await server.server.serve_forever()


def main():
    args = parse_args()
    asyncio.run(main_starter_async(args))


if __name__ == '__main__':
    main()
