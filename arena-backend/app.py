# arena-backend/app.py
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from werkzeug.security import generate_password_hash, check_password_hash
import subprocess
import os
import sys

# ---------------------------------------------------------
# 1. SERVER CONFIGURATION & DATABASE INITIALIZATION
# ---------------------------------------------------------
app = Flask(__name__)
CORS(app) # Enables React frontend to communicate with Flask

# Connect to local MongoDB instance
client = MongoClient('mongodb+srv://jibinsjv:hello123@cluster.pmjk4nz.mongodb.net/?appName=Cluster') 
db = client['buildathon_db']
challenges_collection = db['challenges']
users_collection = db['users']

# ---------------------------------------------------------
# 2. AUTHENTICATION ROUTES
# ---------------------------------------------------------
@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    username = data.get('username')
    password = data.get('password')
    
    if not username or not password: 
        return jsonify({"error": "Required fields missing"}), 400
    
    if users_collection.find_one({"username": username}): 
        return jsonify({"error": "Developer profile already exists"}), 409
    
    # Securely hash the password before storing
    hashed_password = generate_password_hash(password)
    users_collection.insert_one({
        "username": username, 
        "password": hashed_password, 
        "xp": 0, 
        "solved_questions": []
    })
    
    return jsonify({"username": username, "xp": 0, "solved_questions": []})

@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.json
        if not data: return jsonify({"error": "No JSON payload"}), 400
        
        user = users_collection.find_one({"username": data.get('username')})
        if not user:
            return jsonify({"error": "User not found"}), 401
            
        if check_password_hash(user['password'], data.get('password')):
            return jsonify({
                "username": user['username'], 
                "xp": user.get('xp', 0),
                "solved_questions": user.get('solved_questions', [])
            })
        return jsonify({"error": "Invalid password"}), 401
    except Exception as e:
        # IMPORTANT: This will print the exact error to your Render Logs
        print(f"DEBUG_ERROR: {str(e)}") 
        return jsonify({"error": f"Internal Server Error: {str(e)}"}), 500
# ---------------------------------------------------------
# 3. ARENA DATA ROUTES
# ---------------------------------------------------------
@app.route('/api/questions/<difficulty>', methods=['GET'])
def get_questions(difficulty):
    # Fetch all questions for a specific tier, excluding the heavy test logic payload
    questions = list(challenges_collection.find(
        {"difficulty": difficulty.lower()}, 
        {"_id": 0, "id": 1, "title": 1, "difficulty": 1}
    ))
    return jsonify(questions)

@app.route('/api/challenge/<int:q_id>', methods=['GET'])
def get_challenge(q_id):
    # Fetch a specific challenge by ID, including starter code and test cases
    challenge = challenges_collection.find_one({"id": q_id}, {"_id": 0})
    if challenge:
        return jsonify(challenge)
    return jsonify({"error": "Target challenge resource not found"}), 404

# ---------------------------------------------------------
# 4. MULTI-LANGUAGE EXECUTION ENGINE
# ---------------------------------------------------------
@app.route('/execute', methods=['POST'])
def execute_code():
    data = request.json
    language = data.get('language', 'python')
    
    # Combine the user's code with the hidden multi-case test logic from MongoDB
    full_code = data.get('code', '') + "\n" + data.get('test_logic', '')
    
    compile_cmd = None
    is_windows = os.name == 'nt'
    
    # Configure Compiler/Interpreter parameters dynamically
    if language == 'python': 
        filename = "temp_exec.py"
        run_cmd = ['python', filename] if is_windows else ['python3', filename]
        
    elif language == 'javascript': 
        filename = "temp_exec.js"
        run_cmd = ['node', filename]
        
    elif language == 'c': 
        filename = "temp_exec.c"
        compile_cmd = ['gcc', filename, '-o', 'temp_exec']
        run_cmd = ['temp_exec.exe'] if is_windows else ['./temp_exec']
        
    elif language == 'cpp': 
        filename = "temp_exec.cpp"
        compile_cmd = ['g++', filename, '-o', 'temp_exec']
        run_cmd = ['temp_exec.exe'] if is_windows else ['./temp_exec']
        
    elif language == 'java': 
        filename = "Main.java"
        compile_cmd = ['javac', filename]
        run_cmd = ['java', 'Main']
        
    else: 
        return jsonify({"result": "Language unsupported by backend matrix.", "is_success": False})

    # Write the combined code to a temporary file
    with open(filename, "w", encoding="utf-8") as f: 
        f.write(full_code)
        
    output = ""
    is_success = False

    try:
        # STEP 1: Compilation Phase (If required for C, C++, Java)
        if compile_cmd:
            compile_res = subprocess.run(compile_cmd, capture_output=True, text=True)
            if compile_res.returncode != 0:
                raise Exception(f"Compilation Error:\n{compile_res.stderr}")
                
        # STEP 2: Execution Phase (With strict 4-second timeout to prevent infinite loops)
        result = subprocess.run(run_cmd, capture_output=True, text=True, timeout=4)
        output = result.stdout if result.stdout else result.stderr
        
        # Determine success based on the output of our 3-case generator
        is_success = "Pass:" in output
        
    except subprocess.TimeoutExpired:
        output = "Runtime Exception: Execution timed out (Possible infinite loop detected)."
    except Exception as e: 
        output = str(e)
    finally:
        # STEP 3: Rigorous Cleanup of all generated files
        files_to_clean = [
            filename, 
            "temp_exec.exe", 
            "temp_exec", 
            "Main.class"
        ]
        for file in files_to_clean:
            if os.path.exists(file): 
                try:
                    os.remove(file)
                except PermissionError:
                    pass # Safely ignore if Windows locks the file temporarily

    return jsonify({"result": output, "is_success": is_success})

# ---------------------------------------------------------
# 5. SERVER BOOTSTRAP
# ---------------------------------------------------------
if __name__ == '__main__': 
    # Run the Flask development server on port 5000
    print(">>> DevLynix Arena Backend Online - Port 5000")
    app.run(debug=True, port=5000)