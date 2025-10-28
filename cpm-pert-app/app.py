from flask import Flask, jsonify, render_template, request
from services.scheduling import analyze_schedule_with_nodes, validate_tasks

app = Flask(__name__)
PROJECT = {"tasks": []}

@app.get("/")
def home():
    return render_template("index.html")

@app.get("/api/health")
def health():
    return jsonify({"ok": True})

@app.get("/api/tasks")
def get_tasks():
    return jsonify(PROJECT["tasks"])

@app.post("/api/tasks")
def set_tasks():
    data = request.get_json(force=True) or {}
    PROJECT["tasks"] = data.get("tasks", [])
    return jsonify({"ok": True, "count": len(PROJECT["tasks"])})

@app.post("/api/analyze")
def analyze():
    try:
        data = request.get_json(force=True) or {}
        validate_tasks(data)
        result = analyze_schedule_with_nodes(data)
        return jsonify({"ok": True, "result": result})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)