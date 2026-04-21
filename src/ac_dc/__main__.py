"""Entry point for ``python -m ac_dc``.

Delegates to the argparse-based CLI in :mod:`ac_dc.cli`.
"""

from ac_dc.cli import main

if __name__ == "__main__":
    main()