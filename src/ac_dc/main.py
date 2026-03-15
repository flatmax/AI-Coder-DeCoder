"""Main entry point — service construction and server startup."""

import argparse
import sys


def main():
    parser = argparse.ArgumentParser(description="AC⚡DC — AI-assisted code editing")
    parser.add_argument("--server-port", type=int, default=18080, help="RPC WebSocket port")
    parser.add_argument("--webapp-port", type=int, default=18999, help="Webapp port")
    parser.add_argument("--no-browser", action="store_true", help="Don't auto-open browser")
    parser.add_argument("--repo-path", default=".", help="Git repository path")
    parser.add_argument("--dev", action="store_true", help="Run local dev server")
    parser.add_argument("--preview", action="store_true", help="Build and preview")
    parser.add_argument("--verbose", action="store_true", help="Debug logging")
    parser.add_argument("--collab", action="store_true", help="Enable collaboration mode")

    args = parser.parse_args()

    # TODO: Phase 2+ will wire up services and start the server
    print(f"AC⚡DC starting on repo: {args.repo_path}")
    print(f"Server port: {args.server_port}, Webapp port: {args.webapp_port}")


if __name__ == "__main__":
    main()