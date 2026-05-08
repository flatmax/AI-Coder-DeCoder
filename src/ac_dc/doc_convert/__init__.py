"""Document-to-markdown conversion service.

Re-exports the public surface that the rest of the codebase
imports as ``ac_dc.doc_convert``. The module was split from a
single file into a package during the refactor; consumers don't
need to know about the internal layout.

The constants block below mirrors the names that lived at module
level in the pre-split ``doc_convert.py``. Tests and any other
callers that imported them directly continue to work without
needing to know the constants now live in the ``constants``
submodule.

Standard-library re-imports (``shutil``, ``subprocess``,
``tempfile``, ``base64``, ``zipfile``, ``re``, ``hashlib``,
``os``, ``logging``) preserve attribute-style patching from
tests that wrote things like ``mock.patch("ac_dc.doc_convert.
shutil.which", …)`` against the pre-split monolith. These were
all top-level imports in the original module; restoring them
here keeps every existing patch decorator working without any
test changes.
"""

import base64
import hashlib
import logging
import os
import re
import shutil
import subprocess
import tempfile
import zipfile

from .constants import (
    _COLOUR_CLUSTER_DISTANCE,
    _DATA_URI_IMAGE_RE,
    _DEFAULT_EXTENSIONS,
    _DEFAULT_FONT_COLOR,
    _DEFAULT_FONT_SIZE_PT,
    _DEFAULT_SLIDE_HEIGHT_EMU,
    _DEFAULT_SLIDE_WIDTH_EMU,
    _EMU_PER_INCH,
    _EMU_TO_PX,
    _EXCLUDED_DIRS,
    _FALLBACK_MARKERS,
    _IGNORE_NEAR_BLACK_THRESHOLD,
    _IGNORE_NEAR_WHITE_THRESHOLD,
    _LIBREOFFICE_EXTENSIONS,
    _LIBREOFFICE_TIMEOUT_SECONDS,
    _MARKITDOWN_EXTENSIONS,
    _MIME_TO_EXT,
    _NAMED_COLOURS,
    _NAMED_COLOUR_DISTANCE,
    _PAGE_GRAPHICS_THRESHOLD,
    _PATH_SIGNIFICANT_SEGMENTS,
    _PDF_EXTENSIONS,
    _POLYGON_SIGNIFICANT_SEGMENTS,
    _PPTX_EXTENSIONS,
    _PROV_FIELD_RE,
    _PROVENANCE_PROBE_BYTES,
    _PROVENANCE_RE,
    _PT_TO_PX,
    _SLIDE_NUMBER_MIN_WIDTH,
    _SVG_DPI,
    _TRUNCATED_URI_RE,
    _XLSX_EXTENSIONS,
)
from .provenance import ProvenanceHeader
from .service import DocConvert

__all__ = ["DocConvert", "ProvenanceHeader"]