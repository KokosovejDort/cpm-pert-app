from collections import defaultdict, deque
from typing import Dict, List, Set, Tuple, Any

class AoANotSupportedError(Exception):
    """Raised when the AoA network would require dummy activities."""
    pass

class ScheduleValidationError(Exception):
    def __init__(self, errors: List[Dict[str, Any]]):
        self.errors = errors
        super().__init__("Validation failed")


def validate_tasks(tasks: List[Dict[str, Any]]):
    """
    Validates tasks and raises ScheduleValidationError with a list of specific errors
    if any issues are found.
    """

    if not isinstance(tasks, list):
        raise ValueError("Wrong type of objects sent")
        
    if not tasks:
        raise ValueError("Input must be a non-empty list of task objects")

    validation_errors = []
    valid_ids = set()
    seen_ids = set()

    for i, task in enumerate(tasks, start=1):
        tid = task.get("id")
        if not tid or not isinstance(tid, str):
            validation_errors.append({"id": None, "msg": f"Row {i} missing ID"})
            continue
            
        if tid in seen_ids:
            validation_errors.append({"id": tid, "msg": f"Duplicate ID: {tid}"})
        else:
            seen_ids.add(tid)
            valid_ids.add(tid)

        if "duration" not in task:
             validation_errors.append({"id": tid, "msg": "Missing duration"})
        else:
            try:
                d = float(task["duration"])
                if d < 0:
                    validation_errors.append({"id": tid, "msg": "Duration cannot be negative"})
            except:
                validation_errors.append({"id": tid, "msg": "Duration must be a number"})

        deps = task.get("dependencies")
        if deps is not None and not isinstance(deps, list):
             validation_errors.append({"id": tid, "msg": "Dependencies must be a list"})
        
    for task in tasks:
        tid = task.get("id")
        if not tid or tid not in valid_ids: 
            continue 

        deps = task.get("dependencies", [])
        if isinstance(deps, list):
            for dep in deps:
                if dep == tid:
                    validation_errors.append({"id": tid, "msg": "Self-dependency"})
                elif dep not in valid_ids:
                    validation_errors.append({"id": tid, "msg": f"Missing dependency: {dep}"})
    if validation_errors:
        raise ScheduleValidationError(validation_errors)


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

def build_aon_view_from_cpm(
    es: Dict[str, float],
    ef: Dict[str, float],
    ls: Dict[str, float],
    lf: Dict[str, float],
    slack: Dict[str, float],
    preds: Dict[str, Set[str]],
    succs: Dict[str, Set[str]],
    topology: List[str],
    dur: Dict[str, float],
    project_duration: float,
):
    """
    Build Activity-on-Node (AoN) view using CPM results.

    In AoN:
      - each *activity* becomes a node
      - precedence relations become edges (pred -> succ)
    """
    aon_nodes: List[Dict[str, Any]] = []
    aon_edges: List[Dict[str, Any]] = []

    for task_id in topology:
        aon_nodes.append({
            "id": task_id,
            "label": task_id,              
            "duration": dur[task_id],
            "es": es[task_id],
            "ef": ef[task_id],
            "ls": ls[task_id],
            "lf": lf[task_id],
            "slack": slack[task_id],
            "critical": abs(slack[task_id]) < 1e-6,
            "dependencies": list(preds[task_id]),
        })
    for current_id, succ_set in succs.items():
        for succ_id in succ_set:
            aon_edges.append({
                "id": f"{current_id}->{succ_id}",
                "source": current_id,
                "target": succ_id,
            })
    return {
        "project_duration": project_duration,
        "nodes": aon_nodes,
        "edges": aon_edges,
    }


def analyze_schedule_with_nodes(tasks: List[Dict[str, Any]]):
    """
    Combined CPM + AOA node derivation.
    """
    es, ef, ls, lf, slack, projectDuration, preds, succs, topology, dur = cpm_aon(tasks)
    nodes = derive_event_nodes(es, ef, ls, lf, preds, projectDuration)
    aoa_error = None
    task_to_tail: Dict[str, Any] = {}
    task_to_head: Dict[str, Any] = {}

    try:
        for key, data in nodes.items():
            for t in data["members"]:
                task_to_tail[t] = key

        for taskId in topology:
            succ_list = list(succs[taskId])
            if not succ_list:
                task_to_head[taskId] = "END"
                continue
            succ_set = set(succ_list)
            found = False
            for node_key, data in nodes.items():
                members_set = set(data["members"])
                if succ_set.issubset(members_set):
                    task_to_head[taskId] = node_key
                    found = True
                    break
            if not found:
                raise AoANotSupportedError(
                        f"This project requires dummy activities, "
                        f"which are not supported in the current AoA implementation "
                        f"(failed at task {taskId} with successors {succ_list})."
                    )
    except AoANotSupportedError as e:
        aoa_error = str(e)
        task_to_tail = {}
        task_to_head = {}
        result_nodes = []
            
    result_nodes: List[Dict[str, Any]] = []
    key_to_id: Dict[Any, str] = {}
    for idx, (key, data) in enumerate(nodes.items(), start=1):
        if key == "START" or key == "END":
            label = key
        else:
            label = "after{" + ",".join(key) + "}"
        node_id = str(idx)
        key_to_id[key] = node_id
        result_nodes.append({
            "id": node_id, 
            "label": node_id,
            "data_label": label,
            "earliest": data["earliest"],
            "latest": data["latest"],
            "members": data["members"]
        })

    result_tasks: List[Dict[str, Any]] = []
    for taskId in topology:
        tail_id = None
        head_id = None
        if taskId in task_to_tail:
            raw_tail = task_to_tail[taskId]
            tail_id = key_to_id.get(raw_tail)
        if taskId in task_to_head:
            raw_head = task_to_head[taskId]
            head_id = key_to_id.get(raw_head)

        result_tasks.append({
            "id": taskId,
            "name": taskId,
            "duration": dur[taskId],
            "es": es[taskId],
            "ef": ef[taskId],
            "ls": ls[taskId],
            "lf": lf[taskId],
            "slack": slack[taskId],
            "critical": abs(slack[taskId]) < 1e-6,
            "dependencies": list(preds[taskId]),
            "tail_node": tail_id,
            "head_node": head_id,
        })
    aon_view = build_aon_view_from_cpm(
        es=es,
        ef=ef,
        ls=ls,
        lf=lf,
        slack=slack,
        preds=preds,
        succs=succs,
        topology=topology,
        dur=dur,
        project_duration=projectDuration,
    )
    return {
        "project_duration": projectDuration,
        "tasks": result_tasks,
        "nodes": result_nodes,
        "aoa_error": aoa_error,
        "aon": aon_view
    }


