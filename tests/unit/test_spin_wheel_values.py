import re
from pathlib import Path

from backend.routers.spin import WHEEL_VALUES


def test_backend_wheel_values_match_frontend_segments():
    spin_wheel_file = (
        Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "SpinWheel.jsx"
    )
    source = spin_wheel_file.read_text(encoding="utf-8")
    segments_match = re.search(r"const SEGMENTS = \[(.*?)\];", source, re.DOTALL)
    assert segments_match is not None, "Could not find SEGMENTS in SpinWheel.jsx"
    segments_source = segments_match.group(1)
    assert "value:" in segments_source, "SpinWheel segments do not define value fields"

    frontend_values = [int(value) for value in re.findall(r"value:\s*(\d+)", segments_source)]
    assert len(frontend_values) == len(WHEEL_VALUES), "SpinWheel segment values are malformed"
    assert frontend_values == WHEEL_VALUES
