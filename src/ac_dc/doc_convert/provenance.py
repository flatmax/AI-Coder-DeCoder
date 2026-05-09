"""Provenance header reading, writing, and source hashing.

Extracted from the original monolithic ``doc_convert.py`` during
the package split. Every converted output file carries a
``<!-- docuvert: source=… sha256=… images=… -->`` header on its
first line; this module owns the read/write/parse/hash
primitives that the scan and pipelines share.

The free-function shape (rather than methods on a class) is
deliberate: every pipeline module needs ``hash_file`` and
``build_provenance_header``, and several need
``read_prior_images``. Promoting them to module-level functions
lets each pipeline import what it needs without needing a
``DocConvert`` instance — and keeps the orchestrator class free
to focus on dispatch and config.
"""

from __future__ import annotations

import hashlib
import logging
import re
from dataclasses import dataclass
from pathlib import Path

from .constants import (
    _PROV_FIELD_RE,
    _PROVENANCE_PROBE_BYTES,
    _PROVENANCE_RE,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ProvenanceHeader:
    """Parsed docuvert provenance comment.

    Fields match the spec-defined header format. All fields
    optional except `source` and `sha256` — those are the minimum
    to classify status.

    Frozen because the parser returns these to the scanner and the
    scanner should never mutate them; immutability is a small
    safety win.
    """

    source: str
    sha256: str
    images: tuple[str, ...] = ()
    extra: dict[str, str] | None = None


def parse_provenance_body(body: str) -> ProvenanceHeader | None:
    """Parse the key=value pairs inside a docuvert header.

    Returns None when required fields are missing. Exposed as a
    static method so tests and future utilities can exercise the
    parser directly without needing a DocConvert instance.

    Recognised fields:

    - ``source`` — source filename (required)
    - ``sha256`` — source content hash (required)
    - ``images`` — comma-separated list of extracted image
      filenames (optional)

    Any other key=value pairs are captured in `extra` for
    forward compatibility. A future release adding a new
    field (e.g., ``tool_version``) won't cause older clients to
    fail — they just won't display the new field.
    """
    fields: dict[str, str] = {
        match.group(1).lower(): match.group(2)
        for match in _PROV_FIELD_RE.finditer(body)
    }

    source = fields.pop("source", None)
    sha256 = fields.pop("sha256", None)
    if not source or not sha256:
        return None

    images_raw = fields.pop("images", "")
    images = tuple(
        name.strip() for name in images_raw.split(",")
        if name.strip()
    )

    return ProvenanceHeader(
        source=source,
        sha256=sha256,
        images=images,
        extra=fields or None,
    )


def read_provenance_header(
    output_abs: Path,
) -> ProvenanceHeader | None:
    """Read the provenance header from a converted output file.

    Returns None when the file has no header (manually authored),
    when the header is malformed, or when required fields
    (source, sha256) are missing. Lenient on everything else:
    unknown fields land in the `extra` dict for forward
    compatibility with future header additions.

    Reads only the first few KB of the file — the header lives
    on the first line. Reading the whole file would slow
    scanning on repos with large converted outputs.
    """
    try:
        with output_abs.open("rb") as fh:
            probe = fh.read(_PROVENANCE_PROBE_BYTES)
    except OSError as exc:
        logger.debug(
            "DocConvert: failed to read header from %s: %s",
            output_abs, exc,
        )
        return None

    text = probe.decode("utf-8", errors="replace")
    match = _PROVENANCE_RE.search(text)
    if match is None:
        return None

    return parse_provenance_body(match.group(1))


def hash_file(path: Path) -> str:
    """SHA-256 hex digest of a file's content.

    Streams in 64 KB chunks so large files don't need to fit in
    memory. The hex output is what goes into the provenance
    header (shorter prefix would risk collisions across a repo
    with thousands of source files).
    """
    h = hashlib.sha256()
    with path.open("rb") as fh:
        while True:
            chunk = fh.read(65536)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()


def build_provenance_header(
    source_name: str,
    source_hash: str,
    images: tuple[str, ...],
) -> str:
    """Build the `<!-- docuvert: ... -->` header string.

    Fields rendered in a stable order (source, sha256,
    images) so diff noise is minimal when a file is
    re-converted with only one field changing.

    The images field is omitted entirely when no images
    were extracted — keeps the header compact for text-only
    documents. The scan's parser tolerates both shapes
    (pinned by Pass A's `test_empty_images_list_is_empty_tuple`).
    """
    parts = [
        f"source={source_name}",
        f"sha256={source_hash}",
    ]
    if images:
        parts.append(f"images={','.join(images)}")
    body = " ".join(parts)
    return f"<!-- docuvert: {body} -->"


def read_prior_images(
    output_abs: Path,
) -> tuple[str, ...]:
    """Return the images list from an existing output's header.

    Used by the orphan-cleanup path. Empty tuple when no
    prior output exists or the header is absent / malformed.
    """
    if not output_abs.is_file():
        return ()
    header = read_provenance_header(output_abs)
    if header is None:
        return ()
    return header.images