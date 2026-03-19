from flask import Flask, jsonify, render_template, request
from services.scheduling import *
from datetime import date

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
        json = data.get("tasks", [])
        projectStart = data.get("project_start")
        mode = data.get("mode", "cpm")

        if not projectStart:
            projectStart = date.today().isoformat()
        if mode == "pert":
            validate_pert_tasks(json)
            result = analyze_pert(json)
        else:
            validate_tasks(json)
            result = analyze_schedule_with_nodes(json)
            
        result["project_start"] = projectStart
        return jsonify({"ok": True, "result": result})
    except ScheduleValidationError as e:
        return jsonify({
            "ok": False, 
            "error": "Validation Failed", 
            "validation_errors": e.errors  
        }), 400
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)}), 400

if __name__ == "__main__":
    app.run(debug=True)