import os
import subprocess

from ac.port_utils import is_port_in_use


class WebappProcessManager:
    def __init__(self, webapp_dir, port, dev_mode=False):
        self.webapp_dir = webapp_dir
        self.port = port
        self.dev_mode = dev_mode
        self.process = None

    def start_dev_server(self):
        env = os.environ.copy()
        env['PORT'] = str(self.port)
        self.process = subprocess.Popen(
            ['npm', 'run', 'start'],
            cwd=self.webapp_dir,
            env=env
        )
        return self.process

    def start_preview_server(self):
        """Build and then start preview server for debugging"""
        env = os.environ.copy()
        env['PORT'] = str(self.port)
        # Run build first
        build_result = subprocess.run(
            ['npm', 'run', 'build'],
            cwd=self.webapp_dir,
            env=env
        )
        if build_result.returncode != 0:
            raise RuntimeError(f"npm build failed with code {build_result.returncode}")
        # Then start preview server
        self.process = subprocess.Popen(
            ['npm', 'run', 'preview'],
            cwd=self.webapp_dir,
            env=env
        )
        return self.process

    def start_with_port_check(self):
        """Start npm process if port is not already in use"""
        if is_port_in_use(self.port):
            return True
        if self.dev_mode:
            return self.start_preview_server()
        return self.start_dev_server()

    def stop(self):
        if self.process:
            self.process.terminate()
            self.process.wait()


def start_npm_dev_server(webapp_dir, webapp_port, dev_mode=False):
    manager = WebappProcessManager(webapp_dir, webapp_port, dev_mode)
    manager.start_with_port_check()
    return manager
