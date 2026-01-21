import argparse
import asyncio
import os
import webbrowser
from concurrent.futures import ThreadPoolExecutor

from jrpc_oo import JRPCServer
from LiteLLM import LiteLLM
from port_utils import find_available_port
from webapp_server import start_npm_dev_server


def parse_args():
    parser = argparse.ArgumentParser(description='AC-DC: AI Coder / DeCoder')
    parser.add_argument('--server-port', type=int, default=18080,
                        help='JRPC server port (default: 18080)')
    parser.add_argument('--webapp-port', type=int, default=18999,
                        help='Webapp port (default: 18999)')
    parser.add_argument('--no-browser', action='store_true',
                        help='Do not open browser automatically')
    return parser.parse_args()


def get_browser_url(webapp_port, server_port):
    return f"http://localhost:{webapp_port}/?port={server_port}"


def open_browser(webapp_port, server_port):
    url = get_browser_url(webapp_port, server_port)
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
    actual_server_port, actual_webapp_port = await find_ports_async(args.server_port, args.webapp_port)

    print(f"Server port: {actual_server_port}")
    print(f"Webapp port: {actual_webapp_port}")
    print(f"WebSocket URI: ws://localhost:{actual_server_port}")
    print(f"Browser URL: {get_browser_url(actual_webapp_port, actual_server_port)}")

    server = JRPCServer(port=actual_server_port)
    server.add_class(LiteLLM())

    webapp_dir = os.path.join(os.path.dirname(__file__), '..', 'webapp')

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, start_npm_dev_server, webapp_dir, actual_webapp_port)

    if not args.no_browser:
        open_browser(actual_webapp_port, actual_server_port)

    print('starting server...')
    await server.start()

    # Keep the server running
    await server.server.serve_forever()


if __name__ == '__main__':
    args = parse_args()
    asyncio.run(main_starter_async(args))
