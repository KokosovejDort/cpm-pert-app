# cpm_selftest.py
from math import isclose
from services.scheduling import analyze_schedule_with_nodes

TOL = 1e-6

def task_map(tasks_list):
    """Helper: index tasks by id."""
    return {t["id"]: t for t in tasks_list}

def assert_close(a, b, msg):
    assert isclose(a, b, rel_tol=0, abs_tol=TOL), f"{msg}: expected {b}, got {a}"

def test_linear_chain():
    # A(2) -> B(3) -> C(4)  => project = 9, all critical
    tasks = [
        {"id": "A", "duration": 2, "dependencies": []},
        {"id": "B", "duration": 3, "dependencies": ["A"]},
        {"id": "C", "duration": 4, "dependencies": ["B"]},
    ]
    res = analyze_schedule_with_nodes(tasks)
    m = task_map(res["tasks"])

    # ES/EF/LS/LF
    assert_close(m["A"]["es"], 0, "A ES")
    assert_close(m["A"]["ef"], 2, "A EF")
    assert_close(m["A"]["ls"], 0, "A LS")
    assert_close(m["A"]["lf"], 2, "A LF")

    assert_close(m["B"]["es"], 2, "B ES")
    assert_close(m["B"]["ef"], 5, "B EF")
    assert_close(m["B"]["ls"], 2, "B LS")
    assert_close(m["B"]["lf"], 5, "B LF")

    assert_close(m["C"]["es"], 5, "C ES")
    assert_close(m["C"]["ef"], 9, "C EF")
    assert_close(m["C"]["ls"], 5, "C LS")
    assert_close(m["C"]["lf"], 9, "C LF")

    # Slack & critical
    for tid in ("A","B","C"):
        assert_close(m[tid]["slack"], 0, f"{tid} slack")
        assert m[tid]["critical"] is True, f"{tid} should be critical"

    # Project duration
    assert_close(res["project_duration"], 9, "Project duration (linear)")

def test_sample_A_to_H():
    # Your canonical sample:
    # A(3) → B(11) → E(4)/F(6) → G(2)
    # C(13) ────────┘          └→ H(1) depends on D(5),E(4),F(6)
    tasks = [
        {"id": "A", "duration": 3, "dependencies": []},
        {"id": "B", "duration": 11, "dependencies": ["A"]},
        {"id": "C", "duration": 13, "dependencies": []},
        {"id": "D", "duration": 5, "dependencies": ["A"]},
        {"id": "E", "duration": 4, "dependencies": ["B","C"]},
        {"id": "F", "duration": 6, "dependencies": ["B","C"]},
        {"id": "G", "duration": 2, "dependencies": ["F"]},
        {"id": "H", "duration": 1, "dependencies": ["D","E","F"]},
    ]

    res = analyze_schedule_with_nodes(tasks)
    m = task_map(res["tasks"])

    # Expected times
    expected = {
        "A": (0, 3, 0, 3, 0),
        "B": (3, 14, 3, 14, 0),
        "C": (0, 13, 1, 14, 1),
        "D": (3, 8, 16, 21, 13),
        "E": (14, 18, 17, 21, 3),
        "F": (14, 20, 14, 20, 0),
        "G": (20, 22, 20, 22, 0),
        "H": (20, 21, 21, 22, 1),
    }
    for tid, (es, ef, ls, lf, slack) in expected.items():
        assert_close(m[tid]["es"], es, f"{tid} ES")
        assert_close(m[tid]["ef"], ef, f"{tid} EF")
        assert_close(m[tid]["ls"], ls, f"{tid} LS")
        assert_close(m[tid]["lf"], lf, f"{tid} LF")
        assert_close(m[tid]["slack"], slack, f"{tid} slack")

    # Critical set
    critical_ids = {t["id"] for t in res["tasks"] if t["critical"]}
    assert critical_ids == {"A","B","F","G"}, f"Critical path should be A-B-F-G, got {critical_ids}"

    # Project duration
    assert_close(res["project_duration"], 22, "Project duration (A–H)")

    # Node (event) checks (AOA-style)
    # Convert nodes to dict by label for easy lookup
    nodes = {n["node"]: n for n in res["nodes"]}
    # START node (using your simplified convention earliest=latest=0)
    assert_close(nodes["START"]["earliest"], 0, "START earliest")
    assert_close(nodes["START"]["latest"], 0, "START latest")
    # after{A}
    assert_close(nodes["after{A}"]["earliest"], 3, "after{A} earliest")
    assert_close(nodes["after{A}"]["latest"], 3, "after{A} latest")
    # after{B,C}
    assert_close(nodes["after{B,C}"]["earliest"], 14, "after{B,C} earliest")
    assert_close(nodes["after{B,C}"]["latest"], 14, "after{B,C} latest")
    # after{F}
    assert_close(nodes["after{F}"]["earliest"], 20, "after{F} earliest")
    assert_close(nodes["after{F}"]["latest"], 20, "after{F} latest")
    # after{D,E,F}
    assert_close(nodes["after{D,E,F}"]["earliest"], 20, "after{D,E,F} earliest")
    assert_close(nodes["after{D,E,F}"]["latest"], 21, "after{D,E,F} latest")
    # END
    assert_close(nodes["END"]["earliest"], 22, "END earliest")
    assert_close(nodes["END"]["latest"], 22, "END latest")

if __name__ == "__main__":
    # Run both tests and print a friendly message
    test_linear_chain()
    test_sample_A_to_H()
    print("✅ CPM self-test passed: linear chain + A–H example")
