import json
import re
import pytest
from playwright.sync_api import expect
from jsonschema import validate
from json import loads

BASE_URL = "http://127.0.0.1:5000"

REQUEST_SCHEMA = {
    "type": "object",
    "properties": {
        "tasks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {"type": "string", "minLength": 1},
                    "name": {"type": "string", "minLength": 1},
                    "duration": {"type": "number"},
                    "dependencies": {"type": "array", "items": {"type": "string"}}
                },
                "required": ["id", "name", "duration", "dependencies"]
            }
        },
    },
    "required": ["tasks"]
}

# ========== HELPERS (sync) ==========
def get_ui(page, selector="#out", json=False):
    el = page.locator(selector)
    expect(el).to_be_visible()
    text = el.text_content().strip()
    if (not json):
        return text
    elif (json):
        return loads(text)


def cell_input_selector(row_index: int, col_index: int):
    return (
        f'table tbody tr:nth-of-type({row_index}) '
        f'td:nth-of-type({col_index})'
    )

def set_cell(page, row, col, text):
    sel = cell_input_selector(row, col)
    loc = page.locator(sel)
    expect(loc).to_be_visible(timeout=1000)
    loc.click()
    loc.fill("")
    loc.type(str(text))

def add_rows(page, n):
    add_btn = page.locator("#btn-add")
    expect(add_btn).to_be_visible(timeout=10000)
    for _ in range(n):
        add_btn.click()

def fill_rows(page, rows):
    add_rows(page, len(rows)-1)
    for i, r in enumerate(rows, start=1):
        set_cell(page, i, 1, r.get("id", ""))
        set_cell(page, i, 2, r.get("name", ""))
        set_cell(page, i, 3, r.get("duration", ""))
        set_cell(page, i, 4, r.get("dependencies", ""))

def click_analyze_and_capture(page):
    with page.expect_response("**/analyze", timeout=6000) as resp_info:
        page.locator("#btn-analyze").click()
    resp = resp_info.value
    req = resp.request
    try:
        payload = req.post_data_json
    except Exception:
        payload = json.loads(req.post_data or "{}")
    return resp, payload  # only two values

# ========== TEST ==========
def test_table_inputs_build_correct_payload_and_ok_response(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "Task A", "duration": "3", "dependencies": ""},
        {"id": "B", "name": "Task B", "duration": "11.0", "dependencies": "A"},
        {"id": "C", "name": "Task C", "duration": "13.0", "dependencies": ""},
        {"id": "D", "name": "Task D", "duration": "05", "dependencies": "A"},
        {"id": "E", "name": "Task E", "duration": "4", "dependencies": "B,C"},
        {"id": "F", "name": "Task F", "duration": "6", "dependencies": "B, C"},
        {"id": "G", "name": "Task G", "duration": "2", "dependencies": "  F"},
        {"id": "H", "name": "Task H", "duration": "1", "dependencies": "D, E  ,  F"},
    ]
    fill_rows(page, rows)

    resp, payload = click_analyze_and_capture(page)
    assert resp.status == 200, f"Expected HTTP 200 from /analyze, got {resp.status}"
    validate(instance=payload, schema=REQUEST_SCHEMA)

    resp.finished()
    server_json = resp.json().get("result")
    assert server_json is not None, "Server JSON missing 'result' key"

    ui_data = get_ui(page, "#out", True)
    assert isinstance(ui_data, dict), f"UI did not render JSON object, got: {type(ui_data)}"

    # ========== TEST CPM ==========
    by_id = {t["id"]: t for t in payload["tasks"]}
    assert isinstance(by_id["A"]["duration"], (int, float)), f"A.duration should be number, got {type(by_id['A']['duration'])}"
    assert by_id["A"]["duration"] == 3, f"A.duration expected 3, got {by_id['A']['duration']}"
    assert by_id["A"]["dependencies"] == [], f"A.dependencies expected [], got {by_id['A']['dependencies']}"

    assert isinstance(by_id["B"]["duration"], (int, float)), f"B.duration should be number, got {type(by_id['B']['duration'])}"
    assert by_id["B"]["duration"] == 11, f"B.duration expected 11, got {by_id['B']['duration']}"
    assert by_id["B"]["dependencies"] == ["A"], f"B.dependencies expected ['A'], got {by_id['B']['dependencies']}"

    assert isinstance(by_id["C"]["duration"], (int, float)), f"C.duration should be number, got {type(by_id['C']['duration'])}"
    assert by_id["C"]["duration"] == 13, f"C.duration expected 13, got {by_id['C']['duration']}"
    assert by_id["C"]["dependencies"] == [], f"C.dependencies expected [], got {by_id['C']['dependencies']}"

    assert isinstance(by_id["D"]["duration"], (int, float)), f"D.duration should be number, got {type(by_id['D']['duration'])}"
    assert by_id["B"]["duration"] == 11 and by_id["B"]["dependencies"] == ["A"], f"Recheck B failed: duration={by_id['B']['duration']} deps={by_id['B']['dependencies']}"
    assert by_id["C"]["duration"] == 13 and by_id["C"]["dependencies"] == [], f"Recheck C failed: duration={by_id['C']['duration']} deps={by_id['C']['dependencies']}"
    assert by_id["D"]["duration"] == 5 and by_id["D"]["dependencies"] == ["A"], f"D failed: duration={by_id['D']['duration']} deps={by_id['D']['dependencies']}"
    assert by_id["E"]["duration"] == 4 and by_id["E"]["dependencies"] == ["B", "C"], f"E failed: duration={by_id['E']['duration']} deps={by_id['E']['dependencies']}"
    assert by_id["F"]["duration"] == 6 and by_id["F"]["dependencies"] == ["B", "C"], f"F failed: duration={by_id['F']['duration']} deps={by_id['F']['dependencies']}"
    assert by_id["G"]["duration"] == 2 and by_id["G"]["dependencies"] == ["F"], f"G failed: duration={by_id['G']['duration']} deps={by_id['G']['dependencies']}"
    assert by_id["H"]["duration"] == 1 and by_id["H"]["dependencies"] == ["D", "E", "F"], f"H failed: duration={by_id['H']['duration']} deps={by_id['H']['dependencies']}"

    assert server_json["project_duration"] == 22, f"Server project_duration expected 22, got {server_json['project_duration']}"

    assert ui_data["project_duration"] == server_json["project_duration"], f"UI project_duration {ui_data['project_duration']} != server {server_json['project_duration']}"
    assert {t["id"] for t in ui_data["tasks"]} == {t["id"] for t in server_json["tasks"]}, "UI task IDs differ from server task IDs"

    # ========== TEST NODES ==========
    expected_nodes = {
        "START":        {"earliest": 0,  "latest": 0,  "members": ["A", "C"]},
        "after{A}":     {"earliest": 3,  "latest": 3,  "members": ["B", "D"]},
        "after{B,C}":   {"earliest": 14, "latest": 14, "members": ["E", "F"]},
        "after{F}":     {"earliest": 20, "latest": 20, "members": ["G"]},
        "after{D,E,F}": {"earliest": 20, "latest": 21, "members": ["H"]},
        "END":          {"earliest": 22, "latest": 22, "members": []},
    }
    actual_nodes = {n["node"]: n for n in server_json["nodes"]}
    missing = set(expected_nodes) - set(actual_nodes)
    assert not missing, f"Server missing nodes: {missing}"
    for label, exp in expected_nodes.items():
        node = actual_nodes[label]
        assert node["earliest"] == exp["earliest"], f"{label} earliest mismatch (server): got {node['earliest']}, expected {exp['earliest']}"
        assert node["latest"] == exp["latest"], f"{label} latest mismatch (server): got {node['latest']}, expected {exp['latest']}"
        assert node["members"] == exp["members"], f"{label} members mismatch (server): got {node['members']}, expected {exp['members']}"

    ui_nodes = {n["node"]: n for n in ui_data["nodes"]}
    missing_ui = set(expected_nodes) - set(ui_nodes)
    assert not missing_ui, f"UI missing nodes: {missing_ui}"

    for label, exp in expected_nodes.items():
        node = ui_nodes[label]
        assert node["earliest"] == exp["earliest"], f"{label} earliest mismatch (UI): got {node['earliest']}, expected {exp['earliest']}"
        assert node["latest"] == exp["latest"], f"{label} latest mismatch (UI): got {node['latest']}, expected {exp['latest']}"
        assert node["members"] == exp["members"], f"{label} members mismatch (UI): got {node['members']}, expected {exp['members']}"

    for label in expected_nodes:
        a = actual_nodes[label]
        u = ui_nodes[label]
        assert a["earliest"] == u["earliest"], f"{label} earliest mismatch UI vs server: UI {u['earliest']} vs server {a['earliest']}"
        assert a["latest"] == u["latest"], f"{label} latest mismatch UI vs server: UI {u['latest']} vs server {a['latest']}"
        assert a["members"] == u["members"], f"{label} members mismatch UI vs server: UI {u['members']} vs server {a['members']}"

def test_zero_duration_and_parallel_branches(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    # A(0) splits to B(2) and C(5) -> D(1). Project duration should be 6.
    rows = [
        {"id": "A", "name": "A", "duration": "0", "dependencies": ""},
        {"id": "B", "name": "B", "duration": "2", "dependencies": "A"},
        {"id": "C", "name": "C", "duration": "5", "dependencies": "A"},
        {"id": "D", "name": "D", "duration": "1", "dependencies": "B, C"},
    ]
    fill_rows(page, rows)
    resp, payload = click_analyze_and_capture(page)
    assert resp.status == 200, f"Expected HTTP 200 from /analyze, got {resp.status}"
    validate(instance=payload, schema=REQUEST_SCHEMA)

    resp.finished()
    server_json = resp.json().get("result")
    assert server_json["project_duration"] == 6, f"Server project_duration expected 6, got {server_json['project_duration']}"
    ui_data = get_ui(page, "#out", True)
    assert ui_data["project_duration"] == 6, f"UI project_duration expected 6, got {ui_data['project_duration']}"


def test_error_non_numeric_duration(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "x", "dependencies": ""},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for non-numeric duration, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for non-numeric duration, got {data}"
    ui_text = get_ui(page)
    assert "'duration' must be a number" in ui_text, f"UI error text missing numeric-duration message. UI: {ui_text}"

def test_error_negative_duration(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "-1", "dependencies": ""},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for negative duration, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for negative duration, got {data}"
    ui_text = get_ui(page)
    assert "'duration' must be >= 0" in ui_text, f"UI error text missing >= 0 message. UI: {ui_text}"

def test_error_self_dependency(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "1", "dependencies": "A"},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for self-dependency, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for self-dependency, got {data}"
    ui_text = get_ui(page)
    assert "cannot depend on itself" in ui_text, f"UI error text missing self-dependency message. UI: {ui_text}"

def test_error_unknown_dependency(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "1", "dependencies": "B"},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for unknown dependency, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for unknown dependency, got {data}"
    ui_text = get_ui(page)
    assert "dependency 'B' does not exist" in ui_text, f"UI error text missing unknown-dependency message. UI: {ui_text}"

def test_error_duplicate_ids(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "1", "dependencies": ""},
        {"id": "A", "name": "A dup", "duration": "2", "dependencies": ""},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for duplicate IDs, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for duplicate IDs, got {data}"
    ui_text = get_ui(page)
    assert "Duplicate task ids found: A" in ui_text, f"UI error text missing duplicate-IDs message. UI: {ui_text}"

def test_error_cycle_detection(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    rows = [
        {"id": "A", "name": "A", "duration": "1", "dependencies": "B"},
        {"id": "B", "name": "B", "duration": "1", "dependencies": "C"},
        {"id": "C", "name": "C", "duration": "1", "dependencies": "A"},
    ]
    fill_rows(page, rows)
    resp, _ = click_analyze_and_capture(page)

    assert resp.status == 400, f"Expected HTTP 400 for cycle detection, got {resp.status}"
    data = resp.json()
    assert data["ok"] is False, f"Expected ok=False for cycle detection, got {data}"
    ui_text = get_ui(page)
    assert "Cycle detected in dependencies" in ui_text, f"UI error text missing cycle-detected message. UI: {ui_text}"

def test_auto_generated_task_ids_when_exceeding_alphabet(page):
    page.goto(BASE_URL, wait_until="domcontentloaded")
    TOTAL = 1000
    add_rows(page, TOTAL)
    add_btn = page.locator("#btn-add")
    expect(add_btn).to_be_visible(timeout=10000)

    rows = page.locator("table tbody tr")
    expect(rows).to_have_count(TOTAL+1)
    ids = []
    for i in range(1, TOTAL + 1):
        cell = page.locator(f"table tbody tr:nth-of-type({i}) td:nth-of-type(1)")
        val = cell.text_content().strip()
        ids.append(val)

    letters = [chr(ord("A") + i) for i in range(26)]
    expected_ids = []
    index = 0
    suffix = 0
    while len(expected_ids) < TOTAL:
        if suffix == 0:
            expected_ids.append(letters[index])
        else:
            expected_ids.append(f"{letters[index]}{suffix}")
        index += 1
        if index == len(letters):
            index = 0
            suffix += 1
            
    assert ids == expected_ids, (
        f"Auto-generated IDs mismatch!\n"
        f"Expected (first 40): {expected_ids[:40]}\n"
        f"Got (first 40): {ids[:40]}"
    )
