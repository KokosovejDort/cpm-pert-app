from collections import defaultdict, deque
import json


def cpm_aon(tasks):
    """
    Core CPM on Activity-on-Node (AON) network.
    Returns all activity times plus graph relationships.
    """
    preds = {t["id"]: set(t.get("dependencies", [])) for t in tasks}
    succs = defaultdict(set)
    dur = {t["id"]: float(t.get("duration", 0.0)) for t in tasks}
    for task in tasks:
        for prop in task.get("dependencies", []):
            succs[prop].add(task["id"])

    dependenciesCount = {taskId: len(preds[taskId]) for taskId in preds}
    queue = deque([
        taskId 
        for taskId, depCount in dependenciesCount.items()
        if depCount == 0
    ])
    topologicalOder = []
    while queue:
        lesftMostTask = queue.popleft()
        topologicalOder.append(lesftMostTask)
        for dependentTaskId in succs[lesftMostTask]:
            dependenciesCount[dependentTaskId] -= 1
            if dependenciesCount[dependentTaskId] == 0:
                queue.append(dependentTaskId)
    if len(topologicalOder) != len(tasks):
        raise ValueError("Cycle detected in dependencies")

    es, ef = {}, {}
    for taskId in topologicalOder:
        es[taskId] = max((ef[p] for p in preds[taskId]), default=0.0)
        ef[taskId] = es[taskId] + dur[taskId]
    projectDuration = max(ef.values(), default=0.0)

    ls, lf = {}, {}
    for taskId in reversed(topologicalOder):
        lf[taskId] = min((ls[s] for s in succs[taskId]), default=projectDuration)
        ls[taskId] = lf[taskId] - dur[taskId]

    slack = {taskId: ls[taskId] - es[taskId] for taskId in topologicalOder}
    return es, ef, ls, lf, slack, projectDuration, preds, succs, topologicalOder, dur


def derive_event_nodes(es, ef, ls, lf, preds, project_duration):
    """
    Derive AOA-style event (node) times from AON results.
    Each unique predecessor set becomes one event node.
    """
    groups = defaultdict(list)
    for taskId, predsSet in preds.items():
        key = tuple(sorted(predsSet))
        groups[key].append(taskId)

    nodes = {}

    nodes["START"] = {
    "earliest": 0.0,
    "latest": 0.0,
    "members": groups[()]
    }
    del groups[()]

    for key, members in groups.items():
        earliest = max((ef[pred] for pred in key), default=0.0)
        latest = min(ls[taskId] for taskId in members)
        nodes[key] = {"earliest": earliest, "latest": latest, "members": members}

    nodes["END"] = {"earliest": project_duration, "latest": project_duration, "members": []}
    return nodes


def analyze_schedule_with_nodes(tasks):
    """
    Combined CPM + AOA node derivation.
    """
    es, ef, ls, lf, slack, projectDuration, preds, succs, topology, dur = cpm_aon(tasks)
    nodes = derive_event_nodes(es, ef, ls, lf, preds, projectDuration)

    result_tasks = []
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

    result_nodes = []
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


