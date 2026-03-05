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

    # It loops — each iteration it takes a task off the queue, adds it to the order, and "unlocks" its successors by decrementing their count:
    # Iteration 1:
    # pop "A" → topologicalOrder = ["A"]
    # A's successor is B → dependenciesCount["B"] becomes 0 → add B to queue

    # Iteration 2:
    # pop "B" → topologicalOrder = ["A", "B"]
    # B's successor is C → dependenciesCount["C"] becomes 0 → add C to queue

    # Iteration 3:
    # pop "C" → topologicalOrder = ["A", "B", "C"]
    # C has no successors → nothing added
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
    es, ef, ls, lf, slack, projectDuration, preds, succs, topology, dur = cpm_aon(tasks)
    
    pred_sets = set()
    for t in tasks:
        pred_sets.add(frozenset(preds[t["id"]]))
        
    node_id_map = {}
    node_label_map = {}
    node_counter = 1
    
    def get_node_id_and_label(key):
        nonlocal node_counter
        if key not in node_id_map:
            if key == "START" or key == "END":
                node_id_map[key] = key
                node_label_map[key] = key
            elif isinstance(key, frozenset):
                node_id_map[key] = str(node_counter)
                node_label_map[key] = "after{" + ",".join(sorted(list(key))) + "}"
                node_counter += 1
            else: 
                node_id_map[key] = str(node_counter)
                node_label_map[key] = key
                node_counter += 1
        return node_id_map[key]

    get_node_id_and_label("START")
    get_node_id_and_label("END")
    
    task_tails = {}
    for t in topology:
        p_set = frozenset(preds[t])
        if not p_set:
            task_tails[t] = "START"
        else:
            task_tails[t] = get_node_id_and_label(p_set)
            
    task_heads = {}
    for t in topology:
        targets = [s for s in pred_sets if t in s]
        if not targets:
            task_heads[t] = "END"
        elif len(targets) == 1:
            task_heads[t] = get_node_id_and_label(targets[0])
        else:
            target_frozenset = frozenset([t])
            if target_frozenset in pred_sets:
                task_heads[t] = get_node_id_and_label(target_frozenset)
            else:
                task_heads[t] = get_node_id_and_label(f"Completion_{t}")
                
    seen_edges = set()
    dummies = []
    dummy_counter = 1
    
    for t in topology:
        tail = task_tails[t]
        head = task_heads[t]
        
        if (tail, head) in seen_edges:
            new_head = get_node_id_and_label(f"Parallel_{t}")
            task_heads[t] = new_head
            dummies.append({
                "id": f"X{dummy_counter}",
                "name": f"X{dummy_counter}",
                "duration": 0.0,
                "tail_node": new_head,
                "head_node": head,
                "dependencies": [t],
                "is_dummy": True
            })
            dummy_counter += 1
            seen_edges.add((tail, new_head))
            seen_edges.add((new_head, head))
        else:
            seen_edges.add((tail, head))

    for s in pred_sets:
        if not s: continue 
        s_node = get_node_id_and_label(s)
        for x in s:
            x_head = task_heads[x]
            if x_head != s_node:
                if (x_head, s_node) not in seen_edges:
                    dummies.append({
                        "id": f"X{dummy_counter}",
                        "name": f"X{dummy_counter}",
                        "duration": 0.0,
                        "tail_node": x_head,
                        "head_node": s_node,
                        "dependencies": [x],
                        "is_dummy": True
                    })
                    dummy_counter += 1
                    seen_edges.add((x_head, s_node))

    all_activities = []
    for t in topology:
        all_activities.append({
            "id": t,
            "name": t,
            "duration": dur[t],
            "es": es[t], "ef": ef[t],
            "ls": ls[t], "lf": lf[t],
            "slack": slack[t],
            "critical": abs(slack[t]) < 1e-6,
            "dependencies": list(preds[t]),
            "tail_node": task_tails[t],
            "head_node": task_heads[t],
            "is_dummy": False
        })
    all_activities.extend(dummies)

    aoa_succs = defaultdict(list)
    aoa_preds = defaultdict(list)
    for act in all_activities:
        aoa_succs[act["tail_node"]].append(act)
        aoa_preds[act["head_node"]].append(act)
        
    all_node_ids = list(set(aoa_succs.keys()) | set(aoa_preds.keys()))
    node_earliest = {n: 0.0 for n in all_node_ids}
    node_latest = {n: projectDuration for n in all_node_ids}
    
    in_degree = {n: len(aoa_preds[n]) for n in all_node_ids}
    q = deque([n for n, deg in in_degree.items() if deg == 0])
    topo_nodes = []
    
    while q:
        u = q.popleft()
        topo_nodes.append(u)
        for act in aoa_succs[u]:
            v = act["head_node"]
            in_degree[v] -= 1
            if in_degree[v] == 0:
                q.append(v)
                
    for u in topo_nodes:
        for act in aoa_succs[u]:
            v = act["head_node"]
            node_earliest[v] = max(node_earliest[v], node_earliest[u] + act["duration"])
            
    for u in reversed(topo_nodes):
        for act in aoa_succs[u]:
            v = act["head_node"]
            node_latest[u] = min(node_latest[u], node_latest[v] - act["duration"])
            
    for act in all_activities:
        if act.get("is_dummy"):
            u = act["tail_node"]
            v = act["head_node"]
            act["es"] = node_earliest[u]
            act["ef"] = node_earliest[u]
            act["lf"] = node_latest[v]
            act["ls"] = node_latest[v]
            act["slack"] = act["ls"] - act["es"]
            act["critical"] = abs(act["slack"]) < 1e-6

    result_nodes = []
    id_to_label = {v: node_label_map[k] for k, v in node_id_map.items()}
    for n_id in all_node_ids:
        members = [act["id"] for act in aoa_succs[n_id] if not act.get("is_dummy")]
        result_nodes.append({
            "id": n_id,
            "label": n_id,
            "data_label": id_to_label.get(n_id, n_id),
            "earliest": node_earliest[n_id],
            "latest": node_latest[n_id],
            "members": members
        })
        
    aon_view = build_aon_view_from_cpm(
        es=es, ef=ef, ls=ls, lf=lf, slack=slack,
        preds=preds, succs=succs, topology=topology,
        dur=dur, project_duration=projectDuration,
    )
    
    return {
        "project_duration": projectDuration,
        "tasks": all_activities,
        "nodes": result_nodes,
        "aoa_error": None, 
        "aon": aon_view
    }