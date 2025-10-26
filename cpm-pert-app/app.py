from flask import Flask, jsonify, render_template, request
from services.scheduling import *

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
    data = request.get_json(force=True) or {}
    tasks = data.get("tasks", PROJECT["tasks"])
    result = analyze_schedule_with_nodes(tasks)
    
    return jsonify(result)

if __name__ == "__main__":
    app.run(debug=True)