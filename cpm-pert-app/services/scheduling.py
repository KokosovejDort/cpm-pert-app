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
    for t in tasks:
        for p in t.get("dependencies", []):
            succs[p].add(t["id"])

    indeg = {u: len(preds[u]) for u in preds}
    q = deque([u for u, d in indeg.items() if d == 0])
    topo = []
    while q:
        u = q.popleft()
        topo.append(u)
        for v in succs[u]:
            indeg[v] -= 1
            if indeg[v] == 0:
                q.append(v)
    if len(topo) != len(tasks):
        raise ValueError("Cycle detected in dependencies")

    es, ef = {}, {}
    for u in topo:
        es[u] = max((ef[p] for p in preds[u]), default=0.0)
        ef[u] = es[u] + dur[u]
    project_duration = max(ef.values(), default=0.0)

    ls, lf = {}, {}
    for u in reversed(topo):
        lf[u] = min((ls[v] for v in succs[u]), default=project_duration)
        ls[u] = lf[u] - dur[u]

    slack = {u: ls[u] - es[u] for u in topo}
    return es, ef, ls, lf, slack, project_duration, preds, succs, topo, dur


def derive_event_nodes(es, ef, ls, lf, preds, project_duration):
    """
    Derive AOA-style event (node) times from AON results.
    Each unique predecessor set becomes one event node.
    """
    groups = defaultdict(list)
    for t, pset in preds.items():
        key = tuple(sorted(pset))
        groups[key].append(t)

    nodes = {}

    if () in groups:
        start_ls = [ls[t] for t in groups[()]]
        nodes["START"] = {"earliest": 0.0, "latest": min(start_ls) if start_ls else 0.0,
                          "members": groups[()]}
        del groups[()]
    else:
        nodes["START"] = {"earliest": 0.0, "latest": 0.0, "members": []}

    for key, members in groups.items():
        earliest = max((ef[p] for p in key), default=0.0)
        latest = min(ls[t] for t in members)
        nodes[key] = {"earliest": earliest, "latest": latest, "members": members}

    nodes["END"] = {"earliest": project_duration, "latest": project_duration, "members": []}
    return nodes


def analyze_schedule_with_nodes(tasks):
    """
    Combined CPM + AOA node derivation.
    """
    es, ef, ls, lf, slack, proj, preds, succs, topo, dur = cpm_aon(tasks)
    nodes = derive_event_nodes(es, ef, ls, lf, preds, proj)

    result_tasks = []
    for u in topo:
        result_tasks.append({
            "id": u,
            "name": u,
            "duration": dur[u],
            "es": es[u],
            "ef": ef[u],
            "ls": ls[u],
            "lf": lf[u],
            "slack": slack[u],
            "critical": abs(slack[u]) < 1e-6
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
        "project_duration": proj,
        "tasks": result_tasks,
        "nodes": result_nodes
    }


