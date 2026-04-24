"""Tests for SVG geometry helpers — Layer 2.8.3b.

Pure-function tests covering:

- Number parsing (single and sequence)
- Transform parsing (translate, scale, rotate, matrix, chains)
- Matrix composition and point transformation
- Shape bounding boxes (rect, circle, ellipse, polygon, path)
- Containment checks

All tests use exact float arithmetic where possible; where
floating-point drift is expected (rotation, compose chains),
we use ``pytest.approx`` with a tight absolute tolerance.

No SVG tree parsing here — those tests live with the extractor
(2.8.3c onwards).
"""

from __future__ import annotations

import math

import pytest

from ac_dc.doc_index.extractors.svg_geometry import (
    BBox,
    IDENTITY,
    Matrix,
    _parse_number,
    _parse_numbers,
    box_contains,
    circle_bbox,
    compose,
    ellipse_bbox,
    parse_transform,
    path_bbox,
    point_in_box,
    polygon_bbox,
    rect_bbox,
    transform_bbox,
    transform_point,
)


# ---------------------------------------------------------------------------
# Number parsing
# ---------------------------------------------------------------------------


class TestParseNumber:
    def test_integer(self) -> None:
        assert _parse_number("42") == 42.0

    def test_negative_integer(self) -> None:
        assert _parse_number("-42") == -42.0

    def test_decimal(self) -> None:
        assert _parse_number("3.14") == 3.14

    def test_decimal_no_leading_digit(self) -> None:
        # Common in Illustrator output — ".5" instead of "0.5".
        assert _parse_number(".5") == 0.5

    def test_decimal_no_trailing_digit(self) -> None:
        assert _parse_number("5.") == 5.0

    def test_scientific_notation(self) -> None:
        assert _parse_number("1.5e2") == 150.0

    def test_negative_scientific(self) -> None:
        assert _parse_number("-1e-3") == -0.001

    def test_leading_plus(self) -> None:
        assert _parse_number("+7") == 7.0

    def test_whitespace_tolerated(self) -> None:
        assert _parse_number("  42  ") == 42.0

    def test_none_returns_none(self) -> None:
        assert _parse_number(None) is None

    def test_empty_string(self) -> None:
        assert _parse_number("") is None

    def test_garbage(self) -> None:
        assert _parse_number("nope") is None

    def test_multiple_numbers_rejected(self) -> None:
        # Single-number parser rejects sequences.
        assert _parse_number("1 2") is None


class TestParseNumbers:
    def test_empty(self) -> None:
        assert _parse_numbers(None) == []
        assert _parse_numbers("") == []

    def test_whitespace_separated(self) -> None:
        assert _parse_numbers("1 2 3") == [1.0, 2.0, 3.0]

    def test_comma_separated(self) -> None:
        assert _parse_numbers("1,2,3") == [1.0, 2.0, 3.0]

    def test_mixed_separators(self) -> None:
        # SVG authors mix them freely.
        assert _parse_numbers("1, 2 3,4") == [
            1.0, 2.0, 3.0, 4.0,
        ]

    def test_signed_adjacent(self) -> None:
        # "1-2" in SVG path data = "1 -2"
        assert _parse_numbers("1-2") == [1.0, -2.0]

    def test_decimal_adjacent(self) -> None:
        # Illustrator: ".5.3" = [0.5, 0.3]
        # Our regex is permissive but doesn't chain bare decimals
        # without a separator — it parses ".5.3" as ".5" and ".3".
        assert _parse_numbers(".5.3") == [0.5, 0.3]

    def test_scientific(self) -> None:
        assert _parse_numbers("1e2 2.5e-1") == [100.0, 0.25]


# ---------------------------------------------------------------------------
# Transform parsing
# ---------------------------------------------------------------------------


class TestParseTransform:
    def test_empty_returns_identity(self) -> None:
        assert parse_transform("") == IDENTITY
        assert parse_transform(None) == IDENTITY

    def test_translate_single_arg(self) -> None:
        # translate(N) means translate(N, 0)
        m = parse_transform("translate(10)")
        assert m == Matrix(1, 0, 0, 1, 10, 0)

    def test_translate_two_args(self) -> None:
        m = parse_transform("translate(10, 20)")
        assert m == Matrix(1, 0, 0, 1, 10, 20)

    def test_translate_whitespace_args(self) -> None:
        m = parse_transform("translate(10 20)")
        assert m == Matrix(1, 0, 0, 1, 10, 20)

    def test_scale_single_arg(self) -> None:
        # scale(N) means scale(N, N)
        m = parse_transform("scale(2)")
        assert m == Matrix(2, 0, 0, 2, 0, 0)

    def test_scale_two_args(self) -> None:
        m = parse_transform("scale(2, 3)")
        assert m == Matrix(2, 0, 0, 3, 0, 0)

    def test_rotate_origin(self) -> None:
        m = parse_transform("rotate(90)")
        # Rotate 90° CW around origin. cos(90)=0, sin(90)=1.
        assert m.a == pytest.approx(0.0, abs=1e-9)
        assert m.b == pytest.approx(1.0, abs=1e-9)
        assert m.c == pytest.approx(-1.0, abs=1e-9)
        assert m.d == pytest.approx(0.0, abs=1e-9)
        assert m.e == 0.0
        assert m.f == 0.0

    def test_rotate_around_point(self) -> None:
        # rotate(90, 10, 10) — rotate 90° around (10, 10).
        # Origin (0, 0) should map to (20, 0).
        m = parse_transform("rotate(90, 10, 10)")
        x, y = transform_point(m, 0, 0)
        assert x == pytest.approx(20.0, abs=1e-9)
        assert y == pytest.approx(0.0, abs=1e-9)

    def test_matrix_six_args(self) -> None:
        m = parse_transform("matrix(1, 2, 3, 4, 5, 6)")
        assert m == Matrix(1, 2, 3, 4, 5, 6)

    def test_unknown_function_is_identity(self) -> None:
        # skewX / skewY / unknown — fall back to identity.
        m = parse_transform("skewX(30)")
        assert m == IDENTITY

    def test_chain_translate_then_scale(self) -> None:
        # translate(10, 0) scale(2) — applied left to right.
        # A point (1, 0) goes through scale first (in inner-
        # first composition), but the chain semantics here are
        # "outer * inner" where the first function listed is
        # outermost. SVG: transform="translate(10,0) scale(2)"
        # means translate wraps scale, which wraps the content.
        # So a point (1, 0) is scaled to (2, 0), then
        # translated to (12, 0).
        m = parse_transform("translate(10, 0) scale(2)")
        x, y = transform_point(m, 1, 0)
        assert x == 12.0
        assert y == 0.0

    def test_chain_scale_then_translate(self) -> None:
        # transform="scale(2) translate(10, 0)" — scale wraps
        # translate. A point (1, 0) is translated to (11, 0),
        # then scaled to (22, 0).
        m = parse_transform("scale(2) translate(10, 0)")
        x, y = transform_point(m, 1, 0)
        assert x == 22.0
        assert y == 0.0

    def test_malformed_arg_count_falls_through(self) -> None:
        # matrix(1 2 3) — too few args. Identity fallback.
        assert parse_transform("matrix(1 2 3)") == IDENTITY

    def test_whitespace_around_parens(self) -> None:
        m = parse_transform("  translate ( 10 , 20 ) ")
        assert m == Matrix(1, 0, 0, 1, 10, 20)


# ---------------------------------------------------------------------------
# Matrix operations
# ---------------------------------------------------------------------------


class TestCompose:
    def test_identity_left(self) -> None:
        m = Matrix(2, 0, 0, 3, 5, 7)
        assert compose(IDENTITY, m) == m

    def test_identity_right(self) -> None:
        m = Matrix(2, 0, 0, 3, 5, 7)
        assert compose(m, IDENTITY) == m

    def test_translate_compose(self) -> None:
        # translate(1,2) · translate(3,4) = translate(4,6)
        a = Matrix(1, 0, 0, 1, 1, 2)
        b = Matrix(1, 0, 0, 1, 3, 4)
        result = compose(a, b)
        assert result == Matrix(1, 0, 0, 1, 4, 6)

    def test_scale_compose(self) -> None:
        # scale(2) · scale(3) = scale(6)
        a = Matrix(2, 0, 0, 2, 0, 0)
        b = Matrix(3, 0, 0, 3, 0, 0)
        result = compose(a, b)
        assert result == Matrix(6, 0, 0, 6, 0, 0)

    def test_translate_then_scale_order(self) -> None:
        # compose(translate, scale) applied to (1, 0):
        # scale first (2, 0), then translate (+10) → (12, 0).
        t = Matrix(1, 0, 0, 1, 10, 0)
        s = Matrix(2, 0, 0, 2, 0, 0)
        m = compose(t, s)
        x, y = transform_point(m, 1, 0)
        assert x == 12.0
        assert y == 0.0


class TestTransformPoint:
    def test_identity(self) -> None:
        assert transform_point(IDENTITY, 5, 7) == (5.0, 7.0)

    def test_translate(self) -> None:
        m = Matrix(1, 0, 0, 1, 10, 20)
        assert transform_point(m, 5, 7) == (15.0, 27.0)

    def test_scale(self) -> None:
        m = Matrix(2, 0, 0, 3, 0, 0)
        assert transform_point(m, 5, 7) == (10.0, 21.0)

    def test_rotate_90(self) -> None:
        m = parse_transform("rotate(90)")
        x, y = transform_point(m, 1, 0)
        assert x == pytest.approx(0.0, abs=1e-9)
        assert y == pytest.approx(1.0, abs=1e-9)


class TestTransformBbox:
    def test_identity(self) -> None:
        box = BBox(10, 20, 30, 40)
        assert transform_bbox(IDENTITY, box) == box

    def test_translate(self) -> None:
        box = BBox(0, 0, 10, 10)
        m = Matrix(1, 0, 0, 1, 5, 5)
        result = transform_bbox(m, box)
        assert result == BBox(5, 5, 10, 10)

    def test_scale(self) -> None:
        box = BBox(0, 0, 10, 10)
        m = Matrix(2, 0, 0, 2, 0, 0)
        result = transform_bbox(m, box)
        assert result == BBox(0, 0, 20, 20)

    def test_rotate_axis_aligned_envelope(self) -> None:
        # A 10×10 box at origin rotated 45° has a larger
        # axis-aligned envelope — that's the point of
        # transform_bbox. Corners at 45° span roughly
        # 14.14 in each direction.
        box = BBox(0, 0, 10, 10)
        m = parse_transform("rotate(45)")
        result = transform_bbox(m, box)
        # Envelope should be strictly larger than the original
        # in both dimensions.
        assert result.width > 10
        assert result.height > 10


# ---------------------------------------------------------------------------
# Shape bounding boxes
# ---------------------------------------------------------------------------


class TestRectBbox:
    def test_basic(self) -> None:
        assert rect_bbox(10, 20, 30, 40) == BBox(10, 20, 30, 40)

    def test_missing_x_defaults_to_zero(self) -> None:
        assert rect_bbox(None, 20, 30, 40) == BBox(0, 20, 30, 40)

    def test_missing_y_defaults_to_zero(self) -> None:
        assert rect_bbox(10, None, 30, 40) == BBox(10, 0, 30, 40)

    def test_missing_width_returns_none(self) -> None:
        # No width → can't be a container.
        assert rect_bbox(10, 20, None, 40) is None

    def test_zero_width_returns_none(self) -> None:
        assert rect_bbox(10, 20, 0, 40) is None

    def test_negative_width_returns_none(self) -> None:
        assert rect_bbox(10, 20, -5, 40) is None


class TestCircleBbox:
    def test_basic(self) -> None:
        assert circle_bbox(50, 50, 10) == BBox(40, 40, 20, 20)

    def test_missing_cx_defaults_to_zero(self) -> None:
        assert circle_bbox(None, 50, 10) == BBox(-10, 40, 20, 20)

    def test_zero_radius_returns_none(self) -> None:
        assert circle_bbox(50, 50, 0) is None

    def test_negative_radius_returns_none(self) -> None:
        assert circle_bbox(50, 50, -5) is None

    def test_missing_radius_returns_none(self) -> None:
        assert circle_bbox(50, 50, None) is None


class TestEllipseBbox:
    def test_basic(self) -> None:
        result = ellipse_bbox(100, 100, 20, 10)
        assert result == BBox(80, 90, 40, 20)

    def test_zero_rx_returns_none(self) -> None:
        assert ellipse_bbox(100, 100, 0, 10) is None

    def test_zero_ry_returns_none(self) -> None:
        assert ellipse_bbox(100, 100, 20, 0) is None


class TestPolygonBbox:
    def test_triangle(self) -> None:
        # Triangle with vertices (0,0), (10,0), (5,10).
        result = polygon_bbox("0,0 10,0 5,10")
        assert result == BBox(0, 0, 10, 10)

    def test_whitespace_separators(self) -> None:
        result = polygon_bbox("0 0 10 0 5 10")
        assert result == BBox(0, 0, 10, 10)

    def test_negative_coords(self) -> None:
        result = polygon_bbox("-5 -5 5 5")
        assert result == BBox(-5, -5, 10, 10)

    def test_single_point_returns_none(self) -> None:
        assert polygon_bbox("5 5") is None

    def test_empty_returns_none(self) -> None:
        assert polygon_bbox("") is None
        assert polygon_bbox(None) is None

    def test_colinear_points_returns_none(self) -> None:
        # All points on the same horizontal line AND vertical
        # line would have zero area. A horizontal line has
        # zero height but positive width — that's still a
        # valid bbox (polyline-of-collinear-points). This
        # test pins the degenerate case where all points are
        # the same.
        # Note: zero-height bbox with positive width is
        # allowed — polyline_bbox returns None only when BOTH
        # w and h are zero.
        assert polygon_bbox("5 5 5 5") is None

    def test_horizontal_line_has_zero_height(self) -> None:
        # Degenerate polyline — returns a 10×0 box.
        result = polygon_bbox("0 0 10 0")
        assert result == BBox(0, 0, 10, 0)


class TestPathBbox:
    def test_empty_returns_none(self) -> None:
        assert path_bbox("") is None
        assert path_bbox(None) is None

    def test_move_line_absolute(self) -> None:
        # M 0 0 L 10 10 — bbox (0,0,10,10)
        result = path_bbox("M 0 0 L 10 10")
        assert result == BBox(0, 0, 10, 10)

    def test_move_line_relative(self) -> None:
        # M 5 5 l 10 10 — from (5,5) go +10,+10 → (15,15)
        result = path_bbox("M 5 5 l 10 10")
        assert result == BBox(5, 5, 10, 10)

    def test_horizontal_line(self) -> None:
        # M 0 0 H 20 — horizontal line to x=20
        result = path_bbox("M 0 0 H 20")
        assert result == BBox(0, 0, 20, 0)

    def test_vertical_line(self) -> None:
        result = path_bbox("M 0 0 V 15")
        assert result == BBox(0, 0, 0, 15)

    def test_close_path_returns_to_start(self) -> None:
        # M 10 10 L 20 10 L 20 20 Z — triangle, Z closes back.
        result = path_bbox("M 10 10 L 20 10 L 20 20 Z")
        assert result == BBox(10, 10, 10, 10)

    def test_cubic_bezier_includes_control_points(self) -> None:
        # Control points can extend outside the curve —
        # acceptable conservative approximation.
        # M 0 0 C 50 -20, 50 20, 100 0 — control points at
        # y=-20 and y=20 are included in bbox.
        result = path_bbox("M 0 0 C 50 -20, 50 20, 100 0")
        assert result is not None
        assert result.x == 0
        assert result.y == -20
        assert result.width == 100
        assert result.height == 40

    def test_quadratic_bezier(self) -> None:
        # M 0 0 Q 50 100, 100 0 — control point at y=100.
        result = path_bbox("M 0 0 Q 50 100, 100 0")
        assert result is not None
        assert result.y == 0
        assert result.height == 100

    def test_multiple_subpaths(self) -> None:
        # Two subpaths combined — bbox covers both.
        result = path_bbox("M 0 0 L 10 10 M 100 100 L 110 110")
        assert result == BBox(0, 0, 110, 110)

    def test_implicit_line_after_move(self) -> None:
        # M followed by additional coord pairs are implicit
        # line-to commands. M 0 0 10 10 20 20 → three points.
        result = path_bbox("M 0 0 10 10 20 20")
        assert result == BBox(0, 0, 20, 20)

    def test_arc_endpoint_captured(self) -> None:
        # A's final two args are the endpoint.
        # M 0 0 A 50 50 0 0 1 100 0 — endpoint at (100, 0).
        result = path_bbox("M 0 0 A 50 50 0 0 1 100 0")
        assert result is not None
        assert result.right == 100
        assert result.x == 0


# ---------------------------------------------------------------------------
# Containment
# ---------------------------------------------------------------------------


class TestBoxContains:
    def test_strict_containment(self) -> None:
        outer = BBox(0, 0, 100, 100)
        inner = BBox(10, 10, 20, 20)
        assert box_contains(outer, inner) is True

    def test_edge_tangent_is_contained(self) -> None:
        # Inner sits exactly on the outer's edge — considered
        # contained (see function docstring rationale).
        outer = BBox(0, 0, 100, 100)
        inner = BBox(0, 0, 50, 50)  # top-left corners coincide
        assert box_contains(outer, inner) is True

    def test_exact_same_box(self) -> None:
        # Edge-inclusive — same box contains itself.
        box = BBox(0, 0, 100, 100)
        assert box_contains(box, box) is True

    def test_partial_overlap_not_contained(self) -> None:
        outer = BBox(0, 0, 100, 100)
        inner = BBox(50, 50, 100, 100)  # bottom-right spills
        assert box_contains(outer, inner) is False

    def test_inner_outside_entirely(self) -> None:
        outer = BBox(0, 0, 100, 100)
        inner = BBox(200, 200, 50, 50)
        assert box_contains(outer, inner) is False

    def test_degenerate_outer_never_contains(self) -> None:
        # Zero-width outer box can't contain anything.
        outer = BBox(0, 0, 0, 100)
        inner = BBox(0, 0, 0, 50)
        assert box_contains(outer, inner) is False

    def test_floating_point_edge_case(self) -> None:
        # Inner box's right edge sits at outer's right edge
        # after floating-point drift. Epsilon tolerance
        # should accept it.
        outer = BBox(0, 0, 1.0, 1.0)
        inner = BBox(0, 0, 1.0 - 1e-15, 1.0 - 1e-15)
        assert box_contains(outer, inner) is True


class TestPointInBox:
    def test_inside(self) -> None:
        box = BBox(0, 0, 100, 100)
        assert point_in_box(box, 50, 50) is True

    def test_on_edge(self) -> None:
        box = BBox(0, 0, 100, 100)
        assert point_in_box(box, 0, 50) is True  # left edge
        assert point_in_box(box, 100, 50) is True  # right
        assert point_in_box(box, 50, 0) is True  # top
        assert point_in_box(box, 50, 100) is True  # bottom

    def test_on_corner(self) -> None:
        box = BBox(0, 0, 100, 100)
        assert point_in_box(box, 0, 0) is True
        assert point_in_box(box, 100, 100) is True

    def test_outside(self) -> None:
        box = BBox(0, 0, 100, 100)
        assert point_in_box(box, 150, 50) is False
        assert point_in_box(box, -10, 50) is False

    def test_degenerate_box_rejects_all(self) -> None:
        box = BBox(0, 0, 0, 100)
        assert point_in_box(box, 0, 50) is False