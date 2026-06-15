# arena-backend/app.py
import os
import re
import subprocess
from datetime import datetime
from functools import wraps

from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient, ASCENDING
from werkzeug.security import generate_password_hash, check_password_hash

# ---------------------------------------------------------
# 1. SERVER CONFIGURATION & DATABASE INITIALIZATION
# ---------------------------------------------------------
app = Flask(__name__)
CORS(app)

# Load sensitive config from environment variables — never hard-code credentials
MONGO_URI = os.environ.get(
    'MONGO_URI',
    'mongodb+srv://jibinsjv:hello123@cluster.pmjk4nz.mongodb.net/?appName=Cluster'
)

client = MongoClient(MONGO_URI)
db = client['buildathon_db']
challenges_collection = db['challenges']
users_collection = db['users']

# Ensure indexes exist for fast lookups (idempotent — safe to run on every boot)
users_collection.create_index([("username", ASCENDING)], unique=True)
challenges_collection.create_index([("id", ASCENDING)], unique=True)
challenges_collection.create_index([("difficulty", ASCENDING)])

# ---------------------------------------------------------
# 2. CONSTANTS & VALIDATION HELPERS
# ---------------------------------------------------------
USERNAME_MAX_LEN = 32
PASSWORD_MIN_LEN = 6
PASSWORD_MAX_LEN = 128
USERNAME_PATTERN = re.compile(r'^[a-zA-Z0-9_\-]+$')

SUPPORTED_LANGUAGES = {'python', 'javascript', 'c', 'cpp', 'java'}
VALID_DIFFICULTIES = {'easy', 'medium', 'hard'}
CODE_MAX_BYTES = 64_000       # 64 KB — prevents huge payloads
EXECUTION_TIMEOUT = 5         # seconds


def success(data: dict | list, status: int = 200):
    """Uniform success envelope."""
    return jsonify({"ok": True, "data": data}), status


def error(message: str, status: int = 400):
    """Uniform error envelope."""
    return jsonify({"ok": False, "error": message}), status


def validate_auth_payload(data: dict):
    """Returns an error string if the auth payload is invalid, else None."""
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or not password:
        return "Username and password are required."
    if len(username) > USERNAME_MAX_LEN:
        return f"Username must be {USERNAME_MAX_LEN} characters or fewer."
    if not USERNAME_PATTERN.match(username):
        return "Username may only contain letters, numbers, underscores, or hyphens."
    if len(password) < PASSWORD_MIN_LEN:
        return f"Password must be at least {PASSWORD_MIN_LEN} characters."
    if len(password) > PASSWORD_MAX_LEN:
        return f"Password must be {PASSWORD_MAX_LEN} characters or fewer."
    return None


def require_json(f):
    """Decorator: rejects requests with no JSON body."""
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not request.is_json:
            return error("Request must include Content-Type: application/json.", 415)
        if request.get_json(silent=True) is None:
            return error("Invalid or empty JSON body.", 400)
        return f(*args, **kwargs)
    return wrapper


# ---------------------------------------------------------
# 3. AUTHENTICATION ROUTES
# ---------------------------------------------------------
@app.route('/api/register', methods=['POST'])
@require_json
def register():
    data = request.get_json()
    validation_error = validate_auth_payload(data)
    if validation_error:
        return error(validation_error, 400)

    username = data['username'].strip()

    if users_collection.find_one({"username": username}):
        return error("That username is already taken.", 409)

    hashed_password = generate_password_hash(data['password'])
    users_collection.insert_one({
        "username": username,
        "password": hashed_password,
        "xp": 0,
        "solved_questions": [],
        "created_at": datetime.utcnow(),
    })

    return success({
        "username": username,
        "xp": 0,
        "solved_questions": [],
    }, 201)


@app.route('/api/login', methods=['POST'])
@require_json
def login():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    password = data.get('password') or ''

    if not username or not password:
        return error("Username and password are required.", 400)

    user = users_collection.find_one({"username": username})

    # Use a constant-time check to prevent timing attacks — always call
    # check_password_hash even when the user doesn't exist.
    dummy_hash = generate_password_hash("__dummy__")
    stored_hash = user['password'] if user else dummy_hash
    password_ok = check_password_hash(stored_hash, password)

    if not user or not password_ok:
        return error("Invalid username or password.", 401)

    return success({
        "username": user['username'],
        "xp": user.get('xp', 0),
        "solved_questions": user.get('solved_questions', []),
    })


# ---------------------------------------------------------
# 4. USER PROGRESS ROUTE
# ---------------------------------------------------------
@app.route('/api/progress', methods=['POST'])
@require_json
def save_progress():
    data = request.get_json()
    username = (data.get('username') or '').strip()
    question_id = data.get('question_id')
    xp_reward = data.get('xp_reward', 0)

    if not username:
        return error("username is required.", 400)
    if question_id is None:
        return error("question_id is required.", 400)
    if not isinstance(question_id, int):
        return error("question_id must be an integer.", 400)
    if not isinstance(xp_reward, (int, float)) or xp_reward < 0:
        return error("xp_reward must be a non-negative number.", 400)

    result = users_collection.update_one(
        {"username": username},
        {
            "$inc": {"xp": int(xp_reward)},
            "$addToSet": {"solved_questions": question_id},
        }
    )

    if result.matched_count == 0:
        return error("User not found.", 404)

    return success({"message": "Progress saved."})


# ---------------------------------------------------------
# 5. LEADERBOARD ROUTE
# ---------------------------------------------------------
@app.route('/api/leaderboard', methods=['GET'])
def get_leaderboard():
    """Return the top 20 users ranked by XP."""
    try:
        limit = min(int(request.args.get('limit', 20)), 50)
    except (ValueError, TypeError):
        limit = 20

    top_users = list(
        users_collection.find(
            {},
            {"_id": 0, "username": 1, "xp": 1, "solved_questions": 1}
        ).sort("xp", -1).limit(limit)
    )

    # Augment each entry with a solved count for convenience
    for rank, user in enumerate(top_users, start=1):
        user['rank'] = rank
        user['solved_count'] = len(user.get('solved_questions', []))

    return success(top_users)


# ---------------------------------------------------------
# 6. ARENA DATA ROUTES
# ---------------------------------------------------------
@app.route('/api/questions/<difficulty>', methods=['GET'])
def get_questions(difficulty):
    difficulty = difficulty.lower()
    if difficulty not in VALID_DIFFICULTIES:
        return error(f"Difficulty must be one of: {', '.join(VALID_DIFFICULTIES)}.", 400)

    questions = list(challenges_collection.find(
        {"difficulty": difficulty},
        {"_id": 0, "id": 1, "title": 1, "difficulty": 1, "xp_reward": 1}
    ).sort("id", ASCENDING))

    return success(questions)


@app.route('/api/challenge/<int:q_id>', methods=['GET'])
def get_challenge(q_id):
    if q_id < 1:
        return error("Challenge ID must be a positive integer.", 400)

    challenge = challenges_collection.find_one({"id": q_id}, {"_id": 0})
    if not challenge:
        return error(f"Challenge #{q_id} not found.", 404)

    return success(challenge)


# ---------------------------------------------------------
# 7. MULTI-LANGUAGE CODE EXECUTION ENGINE
# ---------------------------------------------------------
@app.route('/execute', methods=['POST'])
@require_json
def execute_code():
    data = request.get_json()
    language = (data.get('language') or '').lower()
    user_code = data.get('code') or ''
    test_logic = data.get('test_logic') or ''

    # --- Input validation ---
    if language not in SUPPORTED_LANGUAGES:
        return jsonify({
            "result": f"Unsupported language '{language}'. Supported: {', '.join(SUPPORTED_LANGUAGES)}.",
            "is_success": False,
        })

    if language == 'java':
        # Find the last closing brace in the user's code and strip it out
        # so the test_logic can safely inject itself inside the Main class.
        last_brace_index = code.rfind('}')
        if last_brace_index != -1:
            code = code[:last_brace_index] + code[last_brace_index+1:]

    full_code = user_code + "\n" + test_logic

    if len(full_code.encode('utf-8')) > CODE_MAX_BYTES:
        return jsonify({
            "result": "Submission exceeds the maximum allowed code size (64 KB).",
            "is_success": False,
        })

    is_windows = os.name == 'nt'
    compile_cmd = None

    # --- Language configuration ---
    if language == 'python':
        filename = "temp_exec.py"
        run_cmd = ['python', filename] if is_windows else ['python3', filename]

    elif language == 'javascript':
        filename = "temp_exec.js"
        run_cmd = ['node', filename]

    elif language == 'c':
        filename = "temp_exec.c"
        compile_cmd = ['gcc', filename, '-o', 'temp_exec', '-lm']
        run_cmd = ['temp_exec.exe'] if is_windows else ['./temp_exec']

    elif language == 'cpp':
        filename = "temp_exec.cpp"
        compile_cmd = ['g++', filename, '-o', 'temp_exec', '-std=c++17']
        run_cmd = ['temp_exec.exe'] if is_windows else ['./temp_exec']

    elif language == 'java':
        filename = "Main.java"
        compile_cmd = ['javac', filename]
        run_cmd = ['java', 'Main']

    # --- Write code to disk ---
    try:
        with open(filename, "w", encoding="utf-8") as f:
            f.write(full_code)
    except OSError as e:
        return jsonify({"result": f"File system error: {e}", "is_success": False})

    output = ""
    is_success = False

    try:
        # STEP 1: Compilation (C, C++, Java)
        if compile_cmd:
            compile_res = subprocess.run(
                compile_cmd,
                capture_output=True,
                text=True,
                timeout=15,
            )
            if compile_res.returncode != 0:
                output = f"Compilation Error:\n{compile_res.stderr.strip()}"
                return jsonify({"result": output, "is_success": False})

        # STEP 2: Execution (strict timeout, no shell=True for security)
        exec_res = subprocess.run(
            run_cmd,
            capture_output=True,
            text=True,
            timeout=EXECUTION_TIMEOUT,
        )
        output = exec_res.stdout.strip() if exec_res.stdout else exec_res.stderr.strip()
        is_success = "Pass:" in output

    except subprocess.TimeoutExpired:
        output = (
            f"Runtime Exception: Execution timed out after {EXECUTION_TIMEOUT}s "
            "(possible infinite loop)."
        )
    except FileNotFoundError as e:
        output = f"Runtime environment not found: {e}. Ensure the required compiler/interpreter is installed."
    except Exception as e:
        output = f"Unexpected execution error: {e}"

    finally:
        # STEP 3: Clean up all generated artefacts
        cleanup_targets = [filename, "temp_exec.exe", "temp_exec", "Main.class"]
        for target in cleanup_targets:
            if os.path.exists(target):
                try:
                    os.remove(target)
                except PermissionError:
                    pass  # Windows may briefly lock the file — safe to skip

    return jsonify({"result": output, "is_success": is_success})


# ---------------------------------------------------------
# 8. GLOBAL ERROR HANDLERS
# ---------------------------------------------------------
@app.errorhandler(404)
def not_found(_e):
    return error("The requested resource does not exist.", 404)


@app.errorhandler(405)
def method_not_allowed(_e):
    return error("HTTP method not allowed for this endpoint.", 405)


@app.errorhandler(500)
def internal_server_error(e):
    app.logger.exception("Unhandled exception: %s", e)
    return error("An unexpected server error occurred. Please try again.", 500)


# ---------------------------------------------------------
# 9. SERVER BOOTSTRAP
# ---------------------------------------------------------
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    debug = os.environ.get('FLASK_DEBUG', 'false').lower() == 'true'
    print(f">>> DevLynix Arena Backend Online — Port {port} | Debug={debug}")
    app.run(debug=debug, port=port)
