import os
import subprocess

from port_utils import is_port_in_use


class WebappProcessManager:
    def __init__(self, webapp_dir, port):
        self.webapp_dir = webapp_dir
        self.port = port
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

    def start_with_port_check(self):
        """Start npm process if port is not already in use"""
        if is_port_in_use(self.port):
            return True
        return self.start_dev_server()

    def stop(self):
        if self.process:
            self.process.terminate()
            self.process.wait()


def start_npm_dev_server(webapp_dir, webapp_port):
    manager = WebappProcessManager(webapp_dir, webapp_port)
    manager.start_with_port_check()
    return manager
