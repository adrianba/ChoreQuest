import re
from pathlib import Path

from backend.routers.spin import WHEEL_VALUES, WHEEL_VALUES_HIGH


def _extract_segments(source: str, var_name: str) -> list[int]:
    """Extract segment values from a JS const array in SpinWheel.jsx."""
    pattern = rf"const {var_name} = \[(.*?)\];"
    match = re.search(pattern, source, re.DOTALL)
    assert match is not None, f"Could not find {var_name} in SpinWheel.jsx"
    segments_source = match.group(1)
    assert "value:" in segments_source, f"{var_name} segments do not define value fields"
    return [int(v) for v in re.findall(r"value:\s*(\d+)", segments_source)]


def _read_spinwheel_source() -> str:
    spin_wheel_file = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "SpinWheel.jsx"
    )
    return spin_wheel_file.read_text(encoding="utf-8")


def test_backend_wheel_values_match_frontend_segments():
    source = _read_spinwheel_source()
    frontend_values = _extract_segments(source, "SEGMENTS")
    assert len(frontend_values) == len(WHEEL_VALUES), "SpinWheel segment values are malformed"
    assert frontend_values == WHEEL_VALUES


def test_backend_wheel_values_high_match_frontend_segments_high():
    source = _read_spinwheel_source()
    frontend_values = _extract_segments(source, "SEGMENTS_HIGH")
    assert len(frontend_values) == len(WHEEL_VALUES_HIGH), "SpinWheel SEGMENTS_HIGH values are malformed"
    assert frontend_values == WHEEL_VALUES_HIGH


def test_high_scoring_minimum_is_3():
    assert min(WHEEL_VALUES_HIGH) >= 3


def test_high_scoring_mostly_5_to_15():
    in_range = sum(1 for v in WHEEL_VALUES_HIGH if 5 <= v <= 15)
    assert in_range >= len(WHEEL_VALUES_HIGH) // 2
