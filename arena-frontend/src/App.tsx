// arena-frontend/src/App.tsx
import React, { useState } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import Confetti from 'react-confetti';
import './App.css';

const API_URL = 'https://devlynix-arena.onrender.com';

function App() {
  // --- USER SESSION STATE ---
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  
  // --- GAMIFICATION STATE ---
  const [totalXP, setTotalXP] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const [solvedQuestions, setSolvedQuestions] = useState<number[]>([]);
  
  // --- NAVIGATION STATE ---
  const [view, setView] = useState('auth'); // 'auth' | 'dashboard' | 'q_list' | 'arena'
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [questionList, setQuestionList] = useState<any[]>([]);
  
  // --- ARENA WORKSPACE STATE ---
  const [activeChallenge, setActiveChallenge] = useState<any>(null);
  const [language, setLanguage] = useState('python');
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(false);

  // ==========================================
  // CORE FUNCTIONS
  // ==========================================

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      // We use the endpoint variable here to keep the URL clean
      const endpoint = isLoginMode ? '/api/login' : '/api/register';
      const res = await axios.post(`${API_URL}${endpoint}`, authForm);
      
      setCurrentUser(res.data.username);
      setTotalXP(res.data.xp);
      setSolvedQuestions(res.data.solved_questions || []);
      setView('dashboard');
    } catch (err: any) { 
      setAuthError(err.response?.data?.error || 'System authentication failure.'); 
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setTotalXP(0);
    setSolvedQuestions([]);
    setView('auth');
    setAuthForm({ username: '', password: '' });
  };

  const loadDifficulty = async (diff: string) => {
    setSelectedDifficulty(diff);
    try {
      const res = await axios.get(`${API_URL}/api/questions/${diff}`);
      setQuestionList(res.data);
      setView('q_list');
    } catch (error) {
      console.error("Failed to load track", error);
    }
  };

  const loadQuestion = async (qId: number) => {
    try {
      const res = await axios.get(`${API_URL}/api/challenge/${qId}`);
      setActiveChallenge(res.data);
      setLanguage('python'); 
      setCode(res.data.starter_code['python']); 
      setOutput('');
      setView('arena');
    } catch (error) {
      console.error("Failed to load problem", error);
    }
  };

  const runCode = async () => {
    setLoading(true); 
    setOutput('Initiating secure container... Compiling and executing matrix...');
    try {
      const res = await axios.post(`${API_URL}/execute`, { code, language, test_logic: activeChallenge.test_logic[language] });
      
      setOutput(res.data.result);
      
      // Trigger success loop if tests pass and question wasn't already solved
      if (res.data.is_success && !solvedQuestions.includes(activeChallenge.id)) {
        setShowConfetti(true); 
        setTotalXP(prev => prev + activeChallenge.xp_reward); 
        setSolvedQuestions([...solvedQuestions, activeChallenge.id]);
        setTimeout(() => setShowConfetti(false), 5000); 
      }
    } catch (err) { 
      setOutput('Fatal Connection Error: Unable to reach execution engine.'); 
    }
    setLoading(false);
  };

  // ==========================================
  // SHARED COMPONENTS
  // ==========================================

  const Navbar = () => (
    <nav className="navbar">
      <div className="brand">
        <div className="logo-box">{'</>'}</div> DevLynix Platform
      </div>
      {currentUser && (
        <div className="user-controls">
          <div className="xp-chip">⭐ {totalXP} XP</div>
          <div className="profile-chip">
            {currentUser} <button onClick={handleLogout} className="text-btn">Log out</button>
          </div>
        </div>
      )}
    </nav>
  );

  // ==========================================
  // VIEWS
  // ==========================================

  // --- VIEW: AUTHENTICATION ---
  if (view === 'auth') {
    return (
      <div className="layout-base">
        <Navbar />
        <div className="auth-center">
          <div className="glass-card auth-box">
            <h2>{isLoginMode ? 'Developer Access' : 'Initialize Profile'}</h2>
            {authError && <div className="alert-error">{authError}</div>}
            <form onSubmit={handleAuthSubmit}>
              <input 
                type="text" 
                placeholder="Username ID" 
                className="input-field" 
                value={authForm.username} 
                onChange={e => setAuthForm({...authForm, username: e.target.value})} 
                required 
              />
              <input 
                type="password" 
                placeholder="Passkey" 
                className="input-field" 
                value={authForm.password} 
                onChange={e => setAuthForm({...authForm, password: e.target.value})} 
                required 
              />
              <button type="submit" className="btn-primary full-width">
                {isLoginMode ? 'Execute Login' : 'Register Node'}
              </button>
            </form>
            <div className="auth-footer" onClick={() => setIsLoginMode(!isLoginMode)}>
              {isLoginMode ? "No profile? Initialize here." : "Existing node? Authenticate here."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // --- VIEW: DASHBOARD & QUESTION LIST ---
  if (view === 'dashboard' || view === 'q_list') {
    return (
      <div className="layout-base scroll-y">
        <Navbar />
        <div className="container-max">
          {view === 'dashboard' ? (
            <div className="fade-in">
              <h1 className="header-title">Execution Tracks</h1>
              <div className="grid-3">
                <div className="glass-card hoverable" onClick={() => loadDifficulty('easy')}>
                  <div className="badge bg-green">Easy Tier</div>
                  <h3>Foundations</h3>
                  <p>20 logic evaluations to warm up your compiler.</p>
                </div>
                <div className="glass-card hoverable" onClick={() => loadDifficulty('medium')}>
                  <div className="badge bg-yellow">Medium Tier</div>
                  <h3>Optimizations</h3>
                  <p>20 structural arrays requiring precise bounds.</p>
                </div>
                <div className="glass-card hoverable" onClick={() => loadDifficulty('hard')}>
                  <div className="badge bg-red">Hard Tier</div>
                  <h3>Systems</h3>
                  <p>20 advanced math and bitwise system targets.</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="fade-in">
              <button className="text-btn mb-4" onClick={() => setView('dashboard')}>
                ← Return to Tracks
              </button>
              <h1 className="header-title">{selectedDifficulty.toUpperCase()} ENVIRONMENT</h1>
              <div className="grid-list">
                {questionList.map(q => (
                  <div 
                    key={q.id} 
                    className={`glass-card list-item ${solvedQuestions.includes(q.id) ? 'solved-card' : ''}`} 
                    onClick={() => loadQuestion(q.id)}
                  >
                    <span className="font-medium">{q.title}</span>
                    {solvedQuestions.includes(q.id) && <span className="text-green">✓ Solved</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- VIEW: ARENA WORKSPACE ---
  return (
    <div className="layout-base no-scroll">
      {showConfetti && <Confetti recycle={false} numberOfPieces={300} />}
      <Navbar />
      
      <div className="arena-split">
        
        {/* LEFT PANEL: Problem Details & Test Cases */}
        <div className="arena-left">
          <div className="p-6 border-b">
            <button className="text-btn" onClick={() => setView('q_list')}>← Exit Workspace</button>
            <h2 className="text-2xl font-bold mt-4">{activeChallenge?.title}</h2>
            <div className="badge bg-brand mt-2">{activeChallenge?.xp_reward} XP Reward</div>
          </div>
          
          <div className="p-6 scroll-y flex-grow">
            <div className="prose text-muted">
              {activeChallenge?.description.split('\n').map((line: string, i: number) => (
                <p key={i}>{line}</p>
              ))}
            </div>
            
            <h3 className="text-lg font-bold mt-8 mb-4">Verification Cases</h3>
            <div className="test-case-grid">
              {activeChallenge?.test_cases?.map((tc: any, idx: number) => (
                <div key={idx} className="test-card">
                  <div className="test-header">Execution Case {idx + 1}</div>
                  <div className="test-body">
                    <div><span className="text-muted">Input Parameter A:</span> <span className="font-mono text-white">{tc.a}</span></div>
                    <div><span className="text-muted">Input Parameter B:</span> <span className="font-mono text-white">{tc.b}</span></div>
                    <div className="mt-2 pt-2 border-t">
                      <span className="text-muted">Expected System Output:</span> <span className="font-mono text-green">{tc.expected}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT PANEL: Editor & Terminal */}
        <div className="arena-right">
          
          {/* Editor Header / Toolbar */}
          <div className="editor-header">
            <select 
              value={language} 
              onChange={e => { 
                setLanguage(e.target.value); 
                setCode(activeChallenge.starter_code[e.target.value]); 
              }} 
              className="select-dark"
            >
              <option value="python">Python 3 (CPython)</option>
              <option value="javascript">JavaScript (V8 Node)</option>
              <option value="c">C (GCC Native)</option>
              <option value="cpp">C++ (G++ Compiler)</option>
              <option value="java">Java (OpenJDK)</option>
            </select>
            
            <button className="btn-primary" onClick={runCode} disabled={loading}>
              {loading ? 'Evaluating...' : 'Run Code Matrix ▶'}
            </button>
          </div>
          
          {/* Monaco Editor Component */}
          <div className="editor-body">
            <Editor 
              height="100%" 
              language={language === 'c' || language === 'cpp' ? 'cpp' : language} 
              theme="vs-dark" 
              value={code} 
              onChange={(val) => setCode(val || '')} 
              options={{ 
                minimap: { enabled: false }, 
                fontSize: 15, 
                padding: { top: 20 }, 
                fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', monospace" 
              }} 
            />
          </div>
          
          {/* Terminal / Console Panel */}
          <div className="console-panel">
            <div className="console-header">System Terminal Output</div>
            <pre className={`console-output ${output.includes('Pass') ? 'text-green' : output.includes('Failed') || output.includes('Error') ? 'text-red' : ''}`}>
              {output || "> Awaiting execution commands..."}
            </pre>
          </div>
          
        </div>
      </div>
    </div>
  );
}

export default App;