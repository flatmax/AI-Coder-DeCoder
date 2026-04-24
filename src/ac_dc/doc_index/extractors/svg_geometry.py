"""SVG coordinate math helpers — pure functions, no extractor state.

Layer 2.8.3b. The SVG extractor (2.8.3c onwards) builds on these
primitives. Kept separate so the geometry logic is testable
without mounting a full extractor or parsing a tree.

Scope:

- **Transform parsing.** ``translate``, ``scale``, ``rotate``,
  ``matrix`` — the four transform ops SVG authors actually use
  in practice. ``skewX``/``skewY`` are rare enough that we
  intentionally don't handle them; they fall through as identity
  matrices so extraction still succeeds on files that use them,
  just with slightly off coordinates.

- **Matrix composition.** Root-to-leaf transform chains are
  composed left-to-right (standard SVG semantics — parent
  transforms apply first, children's transforms nest inside).

- **Point transformation.** Apply a 2×3 affine matrix to an
  (x, y) pair. Used when projecting shape coordinates from
  element-local space to root-canvas space.

- **Bounding box computation** for the five closed shape types
  SVG authors use for containment: ``rect``, ``circle``,
  ``ellipse``, ``polygon``, and ``path`` (via bounding-box
  approximation of ``d`` attribute command endpoints and
  control points).

- **Containment checks.** ``box_contains(outer, inner)`` — a
  strict-containment test that the containment-tree builder
  (2.8.3d) uses to decide which box is the parent of which.

Coordinate system: all outputs are in root-canvas units
(viewBox coordinates). Screen-space conversions are the
frontend's concern, not the extractor's.

Numeric safety: all parsers return ``None`` on any failure
rather than raising. The extractor falls back to "no
containment information available" for shapes with malformed
coordinates — better to miss a containment edge than to crash
on one malformed polygon.
"""

from __future__ import annotations

import math
import re
from typing import NamedTuple


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


class BBox(NamedTuple):
    """Axis-aligned bounding box in root-canvas units.

    ``x``, ``y`` are the top-left corner; ``width``, ``height``
    are strictly positive. A degenerate (zero-area) box has
    either width=0 or height=0 — the containment-tree builder
    treats these as non-containers.
    """

    x: float
    y: float
    width: float
    height: float

    @property
    def right(self) -> float:
        return self.x + self.width

    @property
    def bottom(self) -> float:
        return self.y + self.height

    @property
    def area(self) -> float:
        return self.width * self.height


class Matrix(NamedTuple):
    """2×3 affine matrix — ``[[a, c, e], [b, d, f]]`` in SVG notation.

    Matches SVG's ``matrix(a, b, c, d, e, f)`` argument order.
    Applying the matrix to a point (x, y) produces:

        x' = a*x + c*y + e
        y' = b*x + d*y + f

    Identity is ``Matrix(1, 0, 0, 1, 0, 0)``.
    """

    a: float
    b: float
    c: float
    d: float
    e: float
    f: float


# Identity matrix — re-used so the common "no transform" case
# doesn't allocate fresh tuples.
IDENTITY: Matrix = Matrix(1.0, 0.0, 0.0, 1.0, 0.0, 0.0)


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------


# Matches one SVG number token. Covers integers, decimals,
# scientific notation, and leading-sign cases. Deliberately
# permissive — real-world SVGs from Inkscape / Illustrator use
# every variant.
_NUMBER_RE = re.compile(
    r"""
    [-+]?                   # optional sign
    (?:
        \d+\.\d*            # 1.2, 1.
        |\.\d+              # .5
        |\d+                # 1
    )
    (?:[eE][-+]?\d+)?       # optional exponent
    """,
    re.VERBOSE,
)


def _parse_number(text: str | None) -> float | None:
    """Parse a single number from a string. Returns None on failure.

    Accepts leading and trailing whitespace but rejects multiple
    numbers (callers wanting a sequence use ``_parse_numbers``).
    """
    if text is None:
        return None
    match = _NUMBER_RE.fullmatch(text.strip())
    if match is None:
        return None
    try:
        return float(match.group(0))
    except ValueError:
        return None


def _parse_numbers(text: str | None) -> list[float]:
    """Parse all numbers in a string, separated by whitespace or commas.

    Used by transform argument lists, polygon ``points`` attributes,
    and path ``d`` numeric arguments. Returns an empty list on None
    input or pure-whitespace input; malformed tokens are skipped
    silently so a partial parse recovers what it can.
    """
    if text is None:
        return []
    return [float(m.group(0)) for m in _NUMBER_RE.finditer(text)]


# ---------------------------------------------------------------------------
# Transform parsing
# ---------------------------------------------------------------------------


# Matches a single transform function invocation like
# ``translate(10, 20)`` or ``matrix(1 0 0 1 5 5)``. Captures the
# function name and the argument block.
_TRANSFORM_FUNC_RE = re.compile(
    r"([a-zA-Z]+)\s*\(([^)]*)\)"
)


def parse_transform(text: str | None) -> Matrix:
    """Parse an SVG ``transform`` attribute into a 2×3 matrix.

    Handles ``translate``, ``scale``, ``rotate``, ``matrix``.
    Multiple functions compose left-to-right (standard SVG
    semantics). Unknown functions (``skewX``, ``skewY``, or
    anything malformed) are treated as identity so the rest of
    the transform chain still applies.

    Returns :data:`IDENTITY` for None or empty input.
    """
    if not text:
        return IDENTITY

    result = IDENTITY
    for match in _TRANSFORM_FUNC_RE.finditer(text):
        name = match.group(1).lower()
        args = _parse_numbers(match.group(2))
        func_matrix = _transform_func_to_matrix(name, args)
        result = compose(result, func_matrix)
    return result


def _transform_func_to_matrix(
    name: str, args: list[float]
) -> Matrix:
    """Convert one transform function's args to a matrix.

    Unknown functions and malformed arg counts return identity.
    """
    if name == "translate":
        if len(args) == 1:
            return Matrix(1, 0, 0, 1, args[0], 0.0)
        if len(args) >= 2:
            return Matrix(1, 0, 0, 1, args[0], args[1])
        return IDENTITY

    if name == "scale":
        if len(args) == 1:
            s = args[0]
            return Matrix(s, 0, 0, s, 0, 0)
        if len(args) >= 2:
            return Matrix(args[0], 0, 0, args[1], 0, 0)
        return IDENTITY

    if name == "rotate":
        if len(args) >= 1:
            angle_rad = math.radians(args[0])
            cos_a = math.cos(angle_rad)
            sin_a = math.sin(angle_rad)
            if len(args) >= 3:
                # rotate(angle, cx, cy) — rotate around a point.
                # Equivalent to T(cx,cy) · R(angle) · T(-cx,-cy).
                cx, cy = args[1], args[2]
                m = compose(
                    Matrix(1, 0, 0, 1, cx, cy),
                    Matrix(cos_a, sin_a, -sin_a, cos_a, 0, 0),
                )
                return compose(
                    m, Matrix(1, 0, 0, 1, -cx, -cy)
                )
            return Matrix(cos_a, sin_a, -sin_a, cos_a, 0, 0)
        return IDENTITY

    if name == "matrix":
        if len(args) >= 6:
            return Matrix(
                args[0], args[1], args[2],
                args[3], args[4], args[5],
            )
        return IDENTITY

    # skewX, skewY, unknown functions — identity fallback.
    return IDENTITY


def compose(outer: Matrix, inner: Matrix) -> Matrix:
    """Return the composition ``outer · inner``.

    Applying the result to a point is equivalent to applying
    ``inner`` first, then ``outer``. Matches SVG's semantic:
    parent transforms wrap child transforms, so the parent
    matrix is ``outer`` and the child is ``inner``.
    """
    return Matrix(
        a=outer.a * inner.a + outer.c * inner.b,
        b=outer.b * inner.a + outer.d * inner.b,
        c=outer.a * inner.c + outer.c * inner.d,
        d=outer.b * inner.c + outer.d * inner.d,
        e=outer.a * inner.e + outer.c * inner.f + outer.e,
        f=outer.b * inner.e + outer.d * inner.f + outer.f,
    )


def transform_point(
    matrix: Matrix, x: float, y: float
) -> tuple[float, float]:
    """Apply ``matrix`` to the point ``(x, y)``."""
    return (
        matrix.a * x + matrix.c * y + matrix.e,
        matrix.b * x + matrix.d * y + matrix.f,
    )


def transform_bbox(matrix: Matrix, box: BBox) -> BBox:
    """Transform a bounding box through a matrix.

    Returns the axis-aligned bounding box of the four corners
    after transformation. For rotated boxes, this is larger
    than the original — but the containment tree only cares
    about axis-aligned boxes, so losing rotation is the right
    trade-off here.
    """
    corners = [
        transform_point(matrix, box.x, box.y),
        transform_point(matrix, box.right, box.y),
        transform_point(matrix, box.right, box.bottom),
        transform_point(matrix, box.x, box.bottom),
    ]
    xs = [c[0] for c in corners]
    ys = [c[1] for c in corners]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    return BBox(min_x, min_y, max_x - min_x, max_y - min_y)


# ---------------------------------------------------------------------------
# Shape bounding boxes
# ---------------------------------------------------------------------------


def rect_bbox(
    x: float | None,
    y: float | None,
    width: float | None,
    height: float | None,
) -> BBox | None:
    """Bounding box of a ``<rect>``. Missing values default to 0.

    Returns None when width or height is non-positive — a zero-
    or negative-dimension rect can't act as a container.
    """
    rx = x if x is not None else 0.0
    ry = y if y is not None else 0.0
    rw = width if width is not None else 0.0
    rh = height if height is not None else 0.0
    if rw <= 0 or rh <= 0:
        return None
    return BBox(rx, ry, rw, rh)


def circle_bbox(
    cx: float | None, cy: float | None, r: float | None
) -> BBox | None:
    """Bounding box of a ``<circle>``. Returns None for r <= 0."""
    if r is None or r <= 0:
        return None
    ccx = cx if cx is not None else 0.0
    ccy = cy if cy is not None else 0.0
    return BBox(ccx - r, ccy - r, 2 * r, 2 * r)


def ellipse_bbox(
    cx: float | None,
    cy: float | None,
    rx: float | None,
    ry: float | None,
) -> BBox | None:
    """Bounding box of an ``<ellipse>``. Returns None for rx or ry <= 0."""
    if rx is None or ry is None or rx <= 0 or ry <= 0:
        return None
    ccx = cx if cx is not None else 0.0
    ccy = cy if cy is not None else 0.0
    return BBox(ccx - rx, ccy - ry, 2 * rx, 2 * ry)


def polygon_bbox(points: str | None) -> BBox | None:
    """Axis-aligned bounding box of a ``<polygon>`` or ``<polyline>``.

    Accepts the raw ``points`` attribute string. Returns None
    when fewer than one point can be parsed or the resulting
    box has zero area (a single point, or all points on a
    line).

    Per specs4, the polygon's bbox is the axis-aligned envelope
    of its vertex set — curved edges aren't relevant here
    (polygons and polylines only have straight segments).
    """
    nums = _parse_numbers(points)
    if len(nums) < 4:  # need at least 2 points
        return None
    # Pair them up. Odd trailing token is ignored.
    pair_count = len(nums) // 2
    xs = [nums[i * 2] for i in range(pair_count)]
    ys = [nums[i * 2 + 1] for i in range(pair_count)]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w, h = max_x - min_x, max_y - min_y
    if w <= 0 and h <= 0:
        return None
    return BBox(min_x, min_y, w, h)


# Matches one SVG path command letter (case-preserving).
_PATH_COMMAND_RE = re.compile(r"[MmLlHhVvCcSsQqTtAaZz]")


def path_bbox(d: str | None) -> BBox | None:
    """Approximate bounding box of a ``<path>`` element.

    Walks the ``d`` attribute's command tokens and collects
    every endpoint coordinate. This is an approximation —
    Bézier control points may extend outside the curve's actual
    extent, so the returned box is conservative (strictly
    larger than or equal to the real bounding box for curved
    paths).

    For the containment-tree purpose this is fine: we're
    asking "does this box contain that box?", and a slightly
    oversized container-candidate box still gives a correct
    answer for the common "text inside a rounded-corner box"
    case. The rare case where an over-approximation causes a
    phantom parent is preferable to the alternative (missing
    the real parent because we under-approximated a complex
    path).

    Returns None on malformed input or when the collected
    coordinate set produces a zero-area box.
    """
    if not d:
        return None

    # Split the d-string into command letter + numeric args
    # chunks. The regex captures the command letter; splitting
    # on it leaves the numeric args between commands.
    tokens: list[tuple[str, list[float]]] = []
    last_pos = 0
    current_cmd: str | None = None
    for match in _PATH_COMMAND_RE.finditer(d):
        if current_cmd is not None:
            nums = _parse_numbers(
                d[last_pos:match.start()]
            )
            tokens.append((current_cmd, nums))
        current_cmd = match.group(0)
        last_pos = match.end()
    if current_cmd is not None:
        nums = _parse_numbers(d[last_pos:])
        tokens.append((current_cmd, nums))

    # Walk tokens, tracking the pen position and collecting
    # every endpoint the path reaches. Absolute commands use
    # args verbatim; relative commands (lowercase) add args to
    # the pen position.
    xs: list[float] = []
    ys: list[float] = []
    pen_x, pen_y = 0.0, 0.0
    start_x, start_y = 0.0, 0.0  # subpath start for Z
    for cmd, args in tokens:
        relative = cmd.islower()
        c = cmd.upper()

        # Argument count per command, used to process
        # implicit-repeat groups (e.g., "L 10 10 20 20" = two L
        # commands).
        arity = _PATH_ARITY.get(c, 0)
        if c == "Z":
            pen_x, pen_y = start_x, start_y
            xs.append(pen_x)
            ys.append(pen_y)
            continue
        if arity == 0:
            continue

        # Walk args in chunks of arity.
        i = 0
        while i + arity <= len(args):
            chunk = args[i : i + arity]
            if c == "M" or c == "L" or c == "T":
                # 2 args: x, y
                x, y = chunk[0], chunk[1]
                if relative:
                    x += pen_x
                    y += pen_y
                pen_x, pen_y = x, y
                if c == "M":
                    start_x, start_y = x, y
                    # After first M, subsequent pairs in the
                    # same token are implicit L commands.
                    c = "L"
                xs.append(x)
                ys.append(y)
            elif c == "H":
                # 1 arg: x
                x = chunk[0]
                if relative:
                    x += pen_x
                pen_x = x
                xs.append(x)
                ys.append(pen_y)
            elif c == "V":
                y = chunk[0]
                if relative:
                    y += pen_y
                pen_y = y
                xs.append(pen_x)
                ys.append(y)
            elif c == "C":
                # 6 args: x1 y1 x2 y2 x y — include control
                # points in the bbox (conservative; they may
                # extend outside the curve itself).
                for j in (0, 2, 4):
                    x, y = chunk[j], chunk[j + 1]
                    if relative:
                        x += pen_x
                        y += pen_y
                    xs.append(x)
                    ys.append(y)
                x, y = chunk[4], chunk[5]
                if relative:
                    x += pen_x
                    y += pen_y
                pen_x, pen_y = x, y
            elif c == "S" or c == "Q":
                # 4 args: x1 y1 x y (S reflects prev control)
                for j in (0, 2):
                    x, y = chunk[j], chunk[j + 1]
                    if relative:
                        x += pen_x
                        y += pen_y
                    xs.append(x)
                    ys.append(y)
                x, y = chunk[2], chunk[3]
                if relative:
                    x += pen_x
                    y += pen_y
                pen_x, pen_y = x, y
            elif c == "A":
                # 7 args: rx ry rot large sweep x y — we only
                # care about the endpoint for bbox purposes.
                # Arc bounds can extend past endpoints but the
                # approximation is accepted per module docstring.
                x, y = chunk[5], chunk[6]
                if relative:
                    x += pen_x
                    y += pen_y
                pen_x, pen_y = x, y
                xs.append(x)
                ys.append(y)
            i += arity

    if not xs or not ys:
        return None
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    w, h = max_x - min_x, max_y - min_y
    if w <= 0 and h <= 0:
        return None
    return BBox(min_x, min_y, w, h)


# Argument count per path command. Used by path_bbox to chunk
# numeric args correctly.
_PATH_ARITY: dict[str, int] = {
    "M": 2, "L": 2, "T": 2,
    "H": 1, "V": 1,
    "C": 6, "S": 4, "Q": 4,
    "A": 7,
    "Z": 0,
}


# ---------------------------------------------------------------------------
# Containment
# ---------------------------------------------------------------------------


# Small epsilon for float comparisons — prevents a box that's
# one floating-point-rounding step outside its supposed parent
# from missing the containment check.
_CONTAINMENT_EPSILON = 1e-6


def box_contains(outer: BBox, inner: BBox) -> bool:
    """Return True when ``outer`` strictly contains ``inner``.

    Degenerate boxes (zero width or height) can never contain
    anything — the inner box has no space to sit inside. This
    matters for the containment tree: a zero-area shape isn't
    a candidate parent.

    Boxes that share an edge or a corner are considered
    contained. The containment tree sorts candidates by area
    descending and picks the smallest containing box, so
    edge-tangent containment is rare in practice and the
    edge-inclusive check is the safer default (prevents
    off-by-one misses on hand-authored diagrams where the
    child's outer edge sits exactly on the parent's inner
    edge).
    """
    if outer.width <= 0 or outer.height <= 0:
        return False
    if inner.width < 0 or inner.height < 0:
        return False
    eps = _CONTAINMENT_EPSILON
    return (
        inner.x >= outer.x - eps
        and inner.y >= outer.y - eps
        and inner.right <= outer.right + eps
        and inner.bottom <= outer.bottom + eps
    )


def point_in_box(
    box: BBox, x: float, y: float
) -> bool:
    """Return True when the point ``(x, y)`` is inside ``box``.

    Used to attach text elements to their containing box. Same
    edge-inclusive semantics as :func:`box_contains` — a text
    element positioned exactly on a box's edge is considered
    inside.
    """
    if box.width <= 0 or box.height <= 0:
        return False
    eps = _CONTAINMENT_EPSILON
    return (
        x >= box.x - eps
        and x <= box.right + eps
        and y >= box.y - eps
        and y <= box.bottom + eps
    )