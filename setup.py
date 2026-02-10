from setuptools import setup, find_packages

setup(
    name="ac-dc",
    version="0.1.0",
    packages=find_packages(where="src"),
    package_dir={"": "src"},
    python_requires=">=3.13,<3.14",
    install_requires=[
        "jrpc-oo @ git+https://github.com/flatmax/jrpc-oo.git",
        "litellm>=1.81.4",
        "GitPython",
        "boto3",
        "tiktoken>=0.7",
        "trafilatura>=1.6",
        "tree-sitter>=0.25.2",
        "tree-sitter-python>=0.25.0",
        "tree-sitter-javascript>=0.25.0",
        "tree-sitter-typescript>=0.23.2",
        "tree-sitter-c>=0.24.1",
        "tree-sitter-cpp>=0.23.4",
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
