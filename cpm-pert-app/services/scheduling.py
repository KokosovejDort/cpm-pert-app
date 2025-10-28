from collections import defaultdict, deque
from typing import Dict, List, Set, Tuple, Any


def validate_tasks(tasks: List[Dict[str, Any]]):
    """
    Validate task list:
      - Each task must have a unique string 'id'
      - 'duration' must be a number >= 0
      - 'dependencies' must be a list of existing ids (no self-dependency)
    Raises ValueError with a clear message if invalid.
    """
    if not isinstance(tasks, list) or not tasks:
        raise ValueError("Input must be a non-empty list of task objects")

    ids: List[str] = []
    for i, task in enumerate(tasks, start=1):
        if "id" not in task:
            raise ValueError(f"Task #{i} has no 'id'")
        if not isinstance(task["id"], str) or not task["id"]:
            raise ValueError(f"Task #{i} has invalid 'id' (must be non-empty string).")
        ids.append(task["id"])

        if "duration" not in task:
            raise ValueError(f"Task {task['id']}: missing 'duration'.")

        try:
            duration = float(task["duration"])
        except Exception:
            raise ValueError(f"Task {task['id']}: 'duration' must be a number.")
        if duration < 0:
            raise ValueError(f"Task {task['id']}: 'duration' must be >= 0.")

        dependencies = task.get("dependencies")
        if dependencies is None:
            dependencies = []
            task["dependencies"] = []
        if not isinstance(dependencies, list):
            raise ValueError(f"Task {task['id']}: 'dependencies' must be a list.")
        if task["id"] in dependencies:
            raise ValueError(f"Task {task['id']}: cannot depend on itself.")
        
    id_set = set(ids)
    if len(id_set) != len(ids):
        seen, dups = set(), set()
        for x in ids:
            if x in seen:
                dups.add(x)
            seen.add(x)
        dup_list = ", ".join(sorted(dups))
        raise ValueError(f"Duplicate task ids found: {dup_list}")
    
    for task in tasks:
        for dep in task.get("dependencies", []):
            if dep not in id_set:
                raise ValueError(f"Task {task['id']}: dependency '{dep}' does not exist.")


def cpm_aon(tasks: List[Dict[str, Any]]):
    """
    Core CPM on Activity-on-Node (AON) network.
    Returns all activity times plus graph relationships.
    """
    preds: Dict[str, Set[str]] = {t["id"]: set(t.get("dependencies", [])) for t in tasks}
    succs: Dict[str, Set[str]] = defaultdict(set)
    dur: Dict[str, float] = {t["id"]: float(t.get("duration", 0.0)) for t in tasks}

    for task in tasks:
        for pred in task.get("dependencies", []):
            succs[pred].add(task["id"])

    dependenciesCount: Dict[str, int] = {
        taskId: len(preds[taskId]) for taskId in preds
    }
    queue: deque[str] = deque([
        taskId 
        for taskId, depCount in dependenciesCount.items()
        if depCount == 0
    ])
    topologicalOder: List[str] = []

    while queue:
        currentTaskId = queue.popleft()
        topologicalOder.append(currentTaskId)

        for dependentTaskId in succs[currentTaskId]:
            dependenciesCount[dependentTaskId] -= 1
            if dependenciesCount[dependentTaskId] == 0:
                queue.append(dependentTaskId)

    if len(topologicalOder) != len(tasks):
        raise ValueError("Cycle detected in dependencies")

    es: Dict[str, float] = {}
    ef: Dict[str, float] = {}

    for taskId in topologicalOder:
        es[taskId] = max((ef[p] for p in preds[taskId]), default=0.0)
        ef[taskId] = es[taskId] + dur[taskId]
    projectDuration = max(ef.values(), default=0.0)

    ls: Dict[str, float] = {}
    lf: Dict[str, float] = {}
    for taskId in reversed(topologicalOder):
        lf[taskId] = min((ls[s] for s in succs[taskId]), default=projectDuration)
        ls[taskId] = lf[taskId] - dur[taskId]

    slack: Dict[str, float] = {taskId: ls[taskId] - es[taskId] for taskId in topologicalOder}
    return es, ef, ls, lf, slack, projectDuration, preds, succs, topologicalOder, dur


def derive_event_nodes(
    es: Dict[str, float],
    ef: Dict[str, float],
    ls: Dict[str, float],
    lf: Dict[str, float],
    preds: Dict[str, Set[str]],
    project_duration: float
):
    """
    Derive AOA-style event (node) times from AON results.
    Each unique predecessor set becomes one event node.
    """
    groups: Dict[Tuple[str, ...], List[str]] = defaultdict(list)
    for taskId, predsSet in preds.items():
        key = tuple(sorted(predsSet))
        groups[key].append(taskId)

    nodes: Dict[str, Dict[str, Any]] = {}

    nodes["START"] = {
        "earliest": 0.0,
        "latest": 0.0,
        "members": groups[()]
    }
    if () in groups:
        del groups[()]

    for key, members in groups.items():
        earliest = max((ef[pred] for pred in key), default=0.0)
        latest = min(ls[taskId] for taskId in members)
        nodes[key] = {"earliest": earliest, "latest": latest, "members": members}

    nodes["END"] = {"earliest": project_duration, "latest": project_duration, "members": []}
    return nodes


def analyze_schedule_with_nodes(tasks: List[Dict[str, Any]]):
    """
    Combined CPM + AOA node derivation.
    """
    es, ef, ls, lf, slack, projectDuration, preds, succs, topology, dur = cpm_aon(tasks)
    nodes = derive_event_nodes(es, ef, ls, lf, preds, projectDuration)

    result_tasks: List[Dict[str, Any]] = []
    for taskId in topology:
        result_tasks.append({
            "id": taskId,
            "name": taskId,
            "duration": dur[taskId],
            "es": es[taskId],
            "ef": ef[taskId],
            "ls": ls[taskId],
            "lf": lf[taskId],
            "slack": slack[taskId],
            "critical": abs(slack[taskId]) < 1e-6
        })

    result_nodes: List[Dict[str, Any]] = []
    for key, data in nodes.items():
        if key == "START" or key == "END":
            label = key
        else:
            label = "after{" + ",".join(key) + "}"
        result_nodes.append({
            "node": label,
            "earliest": data["earliest"],
            "latest": data["latest"],
            "members": data["members"]
        })

    return {
        "project_duration": projectDuration,
        "tasks": result_tasks,
        "nodes": result_nodes
    }


