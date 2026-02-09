from setuptools import setup, find_packages

setup(
    name="ac-dc",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.10",
    install_requires=[
        "jrpc-oo>=0.1.0",
        "litellm>=1.0.0",
        "tiktoken>=0.5.0",
        "tree-sitter>=0.21.0",
        "tree-sitter-languages>=1.10.0",
        "trafilatura>=1.6.0",
        "gitpython>=3.1.0",
    ],
    extras_require={
        "dev": [
            "pytest>=7.0",
            "pytest-asyncio>=0.21",
        ]
    },
    entry_points={
        "console_scripts": [
            "ac-dc=ac_dc.main:main",
        ]
    },
)
