// arena-frontend/src/App.tsx
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import axios from 'axios';
import Confetti from 'react-confetti';
import './App.css';

const API_URL = 'https://devlynix-arena.onrender.com';

// ---------------------------------------------------------
// TYPES
// ---------------------------------------------------------
interface User {
  username: string;
  xp: number;
  solved_questions: number[];
}

interface Question {
  id: number;
  title: string;
  difficulty: string;
  xp_reward: number;
}

interface Challenge {
  id: number;
  title: string;
  description: string;
  difficulty: string;
  xp_reward: number;
  starter_code: Record<string, string>;
  test_logic: Record<string, string>;
  test_cases: Array<{ a: unknown; b: unknown; expected: unknown }>;
}

interface LeaderboardEntry {
  rank: number;
  username: string;
  xp: number;
  solved_count: number;
}

type View = 'auth' | 'dashboard' | 'q_list' | 'arena' | 'leaderboard' | 'profile';
type Language = 'python' | 'javascript' | 'c' | 'cpp' | 'java';

// ---------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------
const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'python',     label: 'Python 3 (CPython)' },
  { value: 'javascript', label: 'JavaScript (V8 Node)' },
  { value: 'c',          label: 'C (GCC Native)' },
  { value: 'cpp',        label: 'C++ (G++ Compiler)' },
  { value: 'java',       label: 'Java (OpenJDK)' },
];

const XP_THRESHOLDS = [0, 100, 300, 600, 1000, 1500, 2200, 3000];
const RANK_LABELS   = ['Rookie', 'Coder', 'Engineer', 'Architect', 'Hacker', 'Wizard', 'Legend', 'Elite'];

const ACHIEVEMENTS: Array<{
  id: string;
  label: string;
  description: string;
  icon: string;
  check: (user: User) => boolean;
}> = [
  { id: 'first_solve',   label: 'First Blood',    description: 'Solved your first challenge.',       icon: '🩸', check: u => u.solved_questions.length >= 1 },
  { id: 'five_solves',   label: 'On a Roll',       description: 'Solved 5 challenges.',              icon: '🔥', check: u => u.solved_questions.length >= 5 },
  { id: 'ten_solves',    label: 'Double Digits',   description: 'Solved 10 challenges.',             icon: '💪', check: u => u.solved_questions.length >= 10 },
  { id: 'xp_100',        label: 'XP Boost',        description: 'Earned 100 XP.',                   icon: '⭐', check: u => u.xp >= 100 },
  { id: 'xp_500',        label: 'Power Surge',     description: 'Earned 500 XP.',                   icon: '⚡', check: u => u.xp >= 500 },
  { id: 'xp_1000',       label: 'Thousand Club',   description: 'Earned 1,000 XP.',                 icon: '🏆', check: u => u.xp >= 1000 },
  { id: 'polyglot',      label: 'Polyglot',         description: 'You\'re a dedicated solver.',      icon: '🌐', check: u => u.solved_questions.length >= 20 },
];

function getRankInfo(xp: number) {
  let level = 0;
  for (let i = XP_THRESHOLDS.length - 1; i >= 0; i--) {
    if (xp >= XP_THRESHOLDS[i]) { level = i; break; }
  }
  const next = XP_THRESHOLDS[level + 1] ?? XP_THRESHOLDS[level];
  const prev = XP_THRESHOLDS[level];
  const progress = next === prev ? 100 : Math.round(((xp - prev) / (next - prev)) * 100);
  return { level, label: RANK_LABELS[level], progress, nextXP: next };
}

// ---------------------------------------------------------
// SKELETON LOADER
// ---------------------------------------------------------
const Skeleton: React.FC<{ width?: string; height?: string; className?: string }> = ({
  width = '100%', height = '18px', className = ''
}) => (
  <div
    className={`skeleton ${className}`}
    style={{ width, height }}
    aria-hidden="true"
  />
);

// ---------------------------------------------------------
// MAIN APP
// ---------------------------------------------------------
function App() {
  // --- THEME ---
  const [theme, setTheme] = useState<'dark' | 'light'>(() =>
    (localStorage.getItem('devlynix-theme') as 'dark' | 'light') || 'dark'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('devlynix-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => (t === 'dark' ? 'light' : 'dark'));

  // --- USER SESSION ---
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [authForm, setAuthForm] = useState({ username: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  // --- GAMIFICATION ---
  const [showConfetti, setShowConfetti] = useState(false);

  // --- NAVIGATION ---
  const [view, setView] = useState<View>('auth');
  const [selectedDifficulty, setSelectedDifficulty] = useState('');
  const [questionList, setQuestionList] = useState<Question[]>([]);
  const [questionsLoading, setQuestionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // --- LEADERBOARD ---
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  // --- ARENA ---
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null);
  const [challengeLoading, setChallengeLoading] = useState(false);
  const [language, setLanguage] = useState<Language>('python');
  const [code, setCode] = useState('');
  const [output, setOutput] = useState('');
  const [executing, setExecuting] = useState(false);

  // --- MOBILE NAV ---
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // ---------------------------------------------------------
  // DERIVED STATE
  // ---------------------------------------------------------
  const rankInfo = useMemo(() => getRankInfo(currentUser?.xp ?? 0), [currentUser?.xp]);

  const unlockedAchievements = useMemo(() =>
    currentUser ? ACHIEVEMENTS.filter(a => a.check(currentUser)) : [],
    [currentUser]
  );

  const filteredQuestions = useMemo(() =>
    searchQuery.trim()
      ? questionList.filter(q =>
          q.title.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : questionList,
    [questionList, searchQuery]
  );

  // ---------------------------------------------------------
  // AUTH
  // ---------------------------------------------------------
  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    setAuthLoading(true);
    try {
      const endpoint = isLoginMode ? '/api/login' : '/api/register';
      const res = await axios.post(`${API_URL}${endpoint}`, authForm);
      const data = res.data.data ?? res.data; // support both new & old envelope
      setCurrentUser({
        username: data.username,
        xp: data.xp,
        solved_questions: data.solved_questions || [],
      });
      setView('dashboard');
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        'Authentication failed. Please try again.';
      setAuthError(msg);
    } finally {
      setAuthLoading(false);
    }
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setView('auth');
    setAuthForm({ username: '', password: '' });
    setQuestionList([]);
    setLeaderboard([]);
    setActiveChallenge(null);
    setMobileNavOpen(false);
  };

  // ---------------------------------------------------------
  // NAVIGATION HELPERS
  // ---------------------------------------------------------
  const loadDifficulty = async (diff: string) => {
    setSelectedDifficulty(diff);
    setSearchQuery('');
    setQuestionsLoading(true);
    setView('q_list');
    try {
      const res = await axios.get(`${API_URL}/api/questions/${diff}`);
      setQuestionList(res.data.data ?? res.data);
    } catch {
      setQuestionList([]);
    } finally {
      setQuestionsLoading(false);
    }
  };

  const loadQuestion = async (qId: number) => {
    setChallengeLoading(true);
    setView('arena');
    setOutput('');
    try {
      const res = await axios.get(`${API_URL}/api/challenge/${qId}`);
      const challenge: Challenge = res.data.data ?? res.data;
      setActiveChallenge(challenge);
      setLanguage('python');
      setCode(challenge.starter_code['python'] ?? '');
    } catch {
      setActiveChallenge(null);
    } finally {
      setChallengeLoading(false);
    }
  };

  const loadLeaderboard = useCallback(async () => {
    setLeaderboardLoading(true);
    try {
      const res = await axios.get(`${API_URL}/api/leaderboard`);
      setLeaderboard(res.data.data ?? res.data);
    } catch {
      setLeaderboard([]);
    } finally {
      setLeaderboardLoading(false);
    }
  }, []);

  const navigateTo = (target: View) => {
    setMobileNavOpen(false);
    if (target === 'leaderboard') loadLeaderboard();
    setView(target);
  };

  // ---------------------------------------------------------
  // CODE EXECUTION
  // ---------------------------------------------------------
  const runCode = async () => {
    if (!activeChallenge) return;
    setExecuting(true);
    setOutput('Initializing secure container… compiling and executing…');
    try {
      const res = await axios.post(`${API_URL}/execute`, {
        code,
        language,
        test_logic: activeChallenge.test_logic[language],
      });

      setOutput(res.data.result);

      const alreadySolved = currentUser?.solved_questions.includes(activeChallenge.id);
      if (res.data.is_success && !alreadySolved && currentUser) {
        setShowConfetti(true);
        setTimeout(() => setShowConfetti(false), 5500);

        const updated: User = {
          ...currentUser,
          xp: currentUser.xp + activeChallenge.xp_reward,
          solved_questions: [...currentUser.solved_questions, activeChallenge.id],
        };
        setCurrentUser(updated);

        try {
          await axios.post(`${API_URL}/api/progress`, {
            username: currentUser.username,
            question_id: activeChallenge.id,
            xp_reward: activeChallenge.xp_reward,
          });
        } catch {
          // progress sync failure is non-critical
        }
      }
    } catch {
      setOutput('Fatal Connection Error: Unable to reach the execution engine.');
    } finally {
      setExecuting(false);
    }
  };

  // ---------------------------------------------------------
  // SHARED: NAVBAR
  // ---------------------------------------------------------
  const Navbar = () => (
    <nav className="navbar" role="navigation" aria-label="Main navigation">
      <div className="brand">
        <div className="logo-box" aria-hidden="true">{'</>'}</div>
        <span>DevLynix Platform</span>
      </div>

      {/* Desktop nav links */}
      {currentUser && (
        <div className="nav-links" role="menubar">
          {(['dashboard', 'leaderboard', 'profile'] as View[]).map(v => (
            <button
              key={v}
              role="menuitem"
              className={`nav-link ${view === v ? 'nav-link-active' : ''}`}
              onClick={() => navigateTo(v)}
            >
              {v === 'dashboard' ? '🏠 Arena' : v === 'leaderboard' ? '🏆 Leaderboard' : '👤 Profile'}
            </button>
          ))}
        </div>
      )}

      <div className="nav-right">
        {/* Theme toggle */}
        <button
          className="theme-toggle"
          onClick={toggleTheme}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>

        {currentUser && (
          <>
            <div className="xp-chip" aria-label={`${currentUser.xp} XP`}>
              ⭐ {currentUser.xp.toLocaleString()} XP
            </div>
            <div className="profile-chip">
              <span>{currentUser.username}</span>
              <button onClick={handleLogout} className="text-btn" aria-label="Log out">
                Log out
              </button>
            </div>

            {/* Mobile hamburger */}
            <button
              className="hamburger"
              onClick={() => setMobileNavOpen(o => !o)}
              aria-label="Toggle menu"
              aria-expanded={mobileNavOpen}
            >
              {mobileNavOpen ? '✕' : '☰'}
            </button>
          </>
        )}
      </div>

      {/* Mobile dropdown */}
      {mobileNavOpen && currentUser && (
        <div className="mobile-nav" role="menu">
          {(['dashboard', 'leaderboard', 'profile'] as View[]).map(v => (
            <button key={v} role="menuitem" className="mobile-nav-item" onClick={() => navigateTo(v)}>
              {v === 'dashboard' ? '🏠 Arena' : v === 'leaderboard' ? '🏆 Leaderboard' : '👤 Profile'}
            </button>
          ))}
          <button className="mobile-nav-item text-red" onClick={handleLogout}>
            🚪 Log out
          </button>
        </div>
      )}
    </nav>
  );

  // ---------------------------------------------------------
  // VIEW: AUTHENTICATION
  // ---------------------------------------------------------
  if (view === 'auth') {
    return (
      <div className="layout-base" data-theme={theme}>
        <Navbar />
        <div className="auth-center">
          <div className="glass-card auth-box fade-in">
            <div className="auth-logo" aria-hidden="true">{'</>'}</div>
            <h1 className="auth-title">DevLynix Arena</h1>
            <p className="auth-subtitle">
              {isLoginMode ? 'Sign in to your developer profile' : 'Create your developer profile'}
            </p>

            {authError && (
              <div className="alert-error" role="alert" aria-live="polite">
                {authError}
              </div>
            )}

            <form onSubmit={handleAuthSubmit} noValidate>
              <label className="form-label" htmlFor="username">Username</label>
              <input
                id="username"
                type="text"
                placeholder="e.g. dev_ninja"
                className="input-field"
                value={authForm.username}
                onChange={e => setAuthForm({ ...authForm, username: e.target.value })}
                autoComplete="username"
                maxLength={32}
                required
                aria-required="true"
              />

              <label className="form-label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                placeholder="Min. 6 characters"
                className="input-field"
                value={authForm.password}
                onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                autoComplete={isLoginMode ? 'current-password' : 'new-password'}
                required
                aria-required="true"
              />

              <button
                type="submit"
                className="btn-primary full-width"
                disabled={authLoading}
                aria-busy={authLoading}
              >
                {authLoading
                  ? (isLoginMode ? 'Signing in…' : 'Creating profile…')
                  : (isLoginMode ? 'Sign In' : 'Create Profile')}
              </button>
            </form>

            <div
              className="auth-footer"
              onClick={() => { setIsLoginMode(m => !m); setAuthError(''); }}
              role="button"
              tabIndex={0}
              onKeyDown={e => e.key === 'Enter' && setIsLoginMode(m => !m)}
            >
              {isLoginMode
                ? "Don't have an account? Register here →"
                : 'Already have an account? Sign in →'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // VIEW: DASHBOARD
  // ---------------------------------------------------------
  if (view === 'dashboard') {
    const solvedCount = currentUser?.solved_questions.length ?? 0;
    const { label: rankLabel, progress, nextXP } = rankInfo;

    return (
      <div className="layout-base scroll-y" data-theme={theme}>
        <Navbar />
        <div className="container-max fade-in">

          {/* Welcome banner */}
          <div className="welcome-banner glass-card">
            <div className="welcome-text">
              <h1 className="welcome-title">
                Welcome back, <span className="text-brand">{currentUser?.username}</span> 👋
              </h1>
              <p className="welcome-sub">Rank: <strong>{rankLabel}</strong> · Keep solving to level up</p>
            </div>
            <div className="welcome-rank-badge" aria-label={`Rank: ${rankLabel}`}>
              {rankLabel}
            </div>
          </div>

          {/* Stats row */}
          <div className="stats-grid">
            <div className="stat-card glass-card">
              <div className="stat-icon" aria-hidden="true">⭐</div>
              <div className="stat-value">{(currentUser?.xp ?? 0).toLocaleString()}</div>
              <div className="stat-label">Total XP</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-icon" aria-hidden="true">✅</div>
              <div className="stat-value">{solvedCount}</div>
              <div className="stat-label">Challenges Solved</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-icon" aria-hidden="true">🏅</div>
              <div className="stat-value">{unlockedAchievements.length}</div>
              <div className="stat-label">Achievements</div>
            </div>
            <div className="stat-card glass-card">
              <div className="stat-icon" aria-hidden="true">🎯</div>
              <div className="stat-value">{rankLabel}</div>
              <div className="stat-label">Current Rank</div>
            </div>
          </div>

          {/* XP Progress bar */}
          <div className="glass-card xp-progress-card">
            <div className="xp-progress-header">
              <span>XP Progress to next rank</span>
              <span className="text-muted">{currentUser?.xp.toLocaleString()} / {nextXP.toLocaleString()} XP</span>
            </div>
            <div className="xp-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="XP progress">
              <div className="xp-bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="xp-progress-footer text-muted">{progress}% to <strong>{RANK_LABELS[rankInfo.level + 1] ?? 'Max Rank'}</strong></div>
          </div>

          {/* Difficulty tracks */}
          <h2 className="section-title">Execution Tracks</h2>
          <div className="grid-3">
            {[
              { diff: 'easy',   badge: 'bg-green',  icon: '🟢', title: 'Foundations',   desc: 'Warm up your compiler with 20 logic evaluations.' },
              { diff: 'medium', badge: 'bg-yellow',  icon: '🟡', title: 'Optimizations', desc: '20 structural problems requiring precision.' },
              { diff: 'hard',   badge: 'bg-red',     icon: '🔴', title: 'Systems',        desc: '20 advanced math & bitwise system targets.' },
            ].map(({ diff, badge, icon, title, desc }) => (
              <button
                key={diff}
                className="glass-card hoverable track-card"
                onClick={() => loadDifficulty(diff)}
                aria-label={`Open ${diff} difficulty track`}
              >
                <div className={`badge ${badge}`}>{diff.charAt(0).toUpperCase() + diff.slice(1)} Tier</div>
                <div className="track-icon" aria-hidden="true">{icon}</div>
                <h3>{title}</h3>
                <p>{desc}</p>
              </button>
            ))}
          </div>

          {/* Achievements */}
          <h2 className="section-title">Achievements</h2>
          <div className="achievements-grid">
            {ACHIEVEMENTS.map(a => {
              const unlocked = currentUser ? a.check(currentUser) : false;
              return (
                <div
                  key={a.id}
                  className={`achievement-card glass-card ${unlocked ? 'achievement-unlocked' : 'achievement-locked'}`}
                  title={a.description}
                  aria-label={`${a.label}: ${a.description}${unlocked ? ' (Unlocked)' : ' (Locked)'}`}
                >
                  <div className="achievement-icon" aria-hidden="true">{unlocked ? a.icon : '🔒'}</div>
                  <div className="achievement-label">{a.label}</div>
                  <div className="achievement-desc text-muted">{a.description}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // VIEW: QUESTION LIST
  // ---------------------------------------------------------
  if (view === 'q_list') {
    const diffColors: Record<string, string> = { easy: 'bg-green', medium: 'bg-yellow', hard: 'bg-red' };

    return (
      <div className="layout-base scroll-y" data-theme={theme}>
        <Navbar />
        <div className="container-max fade-in">
          <button className="back-btn text-btn" onClick={() => setView('dashboard')} aria-label="Back to dashboard">
            ← Return to Tracks
          </button>
          <h1 className="header-title">
            <span className={`badge ${diffColors[selectedDifficulty] ?? 'bg-brand'} title-badge`}>
              {selectedDifficulty.toUpperCase()}
            </span>
            &nbsp;Environment
          </h1>

          {/* Search */}
          <div className="search-bar-wrap">
            <span className="search-icon" aria-hidden="true">🔍</span>
            <input
              type="search"
              className="search-input"
              placeholder="Filter challenges…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              aria-label="Search challenges"
            />
            {searchQuery && (
              <button className="search-clear text-btn" onClick={() => setSearchQuery('')} aria-label="Clear search">✕</button>
            )}
          </div>

          {/* List */}
          {questionsLoading ? (
            <div className="grid-list">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="glass-card list-item">
                  <Skeleton width="60%" />
                  <Skeleton width="60px" />
                </div>
              ))}
            </div>
          ) : filteredQuestions.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">{searchQuery ? '🔍' : '📭'}</div>
              <p>{searchQuery ? `No challenges match "${searchQuery}"` : 'No challenges found in this tier.'}</p>
              {searchQuery && (
                <button className="btn-outline" onClick={() => setSearchQuery('')}>Clear filter</button>
              )}
            </div>
          ) : (
            <div className="grid-list">
              {filteredQuestions.map(q => {
                const solved = currentUser?.solved_questions.includes(q.id) ?? false;
                return (
                  <button
                    key={q.id}
                    className={`glass-card list-item ${solved ? 'solved-card' : ''}`}
                    onClick={() => loadQuestion(q.id)}
                    aria-label={`${q.title}${solved ? ' (Solved)' : ''} — ${q.xp_reward} XP`}
                  >
                    <div className="list-item-left">
                      <span className="list-solved-dot" aria-hidden="true">{solved ? '✅' : '⬜'}</span>
                      <span className="font-medium">{q.title}</span>
                    </div>
                    <span className="xp-pill">+{q.xp_reward} XP</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Count */}
          {!questionsLoading && filteredQuestions.length > 0 && (
            <p className="result-count text-muted">
              Showing {filteredQuestions.length} of {questionList.length} challenges
            </p>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // VIEW: LEADERBOARD
  // ---------------------------------------------------------
  if (view === 'leaderboard') {
    return (
      <div className="layout-base scroll-y" data-theme={theme}>
        <Navbar />
        <div className="container-max fade-in">
          <h1 className="header-title">🏆 Leaderboard</h1>

          {leaderboardLoading ? (
            <div className="leaderboard-table glass-card">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="lb-row lb-row-skeleton">
                  <Skeleton width="30px" />
                  <Skeleton width="140px" />
                  <Skeleton width="70px" />
                  <Skeleton width="50px" />
                </div>
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon" aria-hidden="true">🏆</div>
              <p>No rankings yet. Be the first to solve a challenge!</p>
            </div>
          ) : (
            <div className="leaderboard-table glass-card">
              <div className="lb-header lb-row">
                <span>#</span>
                <span>Developer</span>
                <span>XP</span>
                <span>Solved</span>
              </div>
              {leaderboard.map(entry => {
                const isMe = entry.username === currentUser?.username;
                const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : `#${entry.rank}`;
                return (
                  <div
                    key={entry.username}
                    className={`lb-row ${isMe ? 'lb-row-me' : ''} ${entry.rank <= 3 ? 'lb-row-top' : ''}`}
                    aria-label={`Rank ${entry.rank}: ${entry.username}, ${entry.xp} XP, ${entry.solved_count} solved${isMe ? ' (you)' : ''}`}
                  >
                    <span className="lb-rank">{medal}</span>
                    <span className="lb-username">
                      {entry.username}
                      {isMe && <span className="lb-you-badge">YOU</span>}
                    </span>
                    <span className="lb-xp">⭐ {entry.xp.toLocaleString()}</span>
                    <span className="lb-solved text-muted">{entry.solved_count} solved</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // VIEW: PROFILE
  // ---------------------------------------------------------
  if (view === 'profile') {
    const { label: rankLabel, progress, nextXP } = rankInfo;
    return (
      <div className="layout-base scroll-y" data-theme={theme}>
        <Navbar />
        <div className="container-max fade-in">
          <h1 className="header-title">👤 Profile</h1>

          <div className="profile-grid">
            {/* Summary card */}
            <div className="glass-card profile-card">
              <div className="profile-avatar" aria-hidden="true">
                {currentUser?.username.charAt(0).toUpperCase()}
              </div>
              <h2 className="profile-name">{currentUser?.username}</h2>
              <div className={`badge bg-brand profile-rank-badge`}>{rankLabel}</div>

              <div className="profile-stats">
                <div className="profile-stat">
                  <div className="profile-stat-value">{(currentUser?.xp ?? 0).toLocaleString()}</div>
                  <div className="profile-stat-label text-muted">Total XP</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{currentUser?.solved_questions.length ?? 0}</div>
                  <div className="profile-stat-label text-muted">Solved</div>
                </div>
                <div className="profile-stat">
                  <div className="profile-stat-value">{unlockedAchievements.length}</div>
                  <div className="profile-stat-label text-muted">Badges</div>
                </div>
              </div>

              <div className="xp-progress-card" style={{ marginTop: '24px' }}>
                <div className="xp-progress-header">
                  <span>Progress to next rank</span>
                  <span className="text-muted">{progress}%</span>
                </div>
                <div className="xp-bar-track" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className="xp-bar-fill" style={{ width: `${progress}%` }} />
                </div>
                <div className="xp-progress-footer text-muted">
                  {currentUser?.xp.toLocaleString()} / {nextXP.toLocaleString()} XP
                </div>
              </div>
            </div>

            {/* Achievements card */}
            <div className="glass-card profile-achievements-card">
              <h3 className="section-title" style={{ marginTop: 0 }}>Achievements</h3>
              <div className="achievements-grid">
                {ACHIEVEMENTS.map(a => {
                  const unlocked = currentUser ? a.check(currentUser) : false;
                  return (
                    <div
                      key={a.id}
                      className={`achievement-card ${unlocked ? 'achievement-unlocked' : 'achievement-locked'}`}
                      title={a.description}
                    >
                      <div className="achievement-icon">{unlocked ? a.icon : '🔒'}</div>
                      <div className="achievement-label">{a.label}</div>
                      <div className="achievement-desc text-muted">{a.description}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------
  // VIEW: ARENA (CODE EDITOR)
  // ---------------------------------------------------------
  const outputClass =
    output.includes('Pass') ? 'text-green'
    : (output.includes('Failed') || output.includes('Error') || output.includes('Exception')) ? 'text-red'
    : '';

  return (
    <div className="layout-base no-scroll" data-theme={theme}>
      {showConfetti && <Confetti recycle={false} numberOfPieces={320} />}
      <Navbar />

      <div className="arena-split">
        {/* LEFT: Problem & test cases */}
        <div className="arena-left" role="complementary" aria-label="Problem description">
          <div className="arena-left-header">
            <button className="text-btn" onClick={() => setView('q_list')} aria-label="Exit workspace">
              ← Exit Workspace
            </button>

            {challengeLoading ? (
              <>
                <Skeleton width="70%" height="28px" className="mt-4" />
                <Skeleton width="80px" height="22px" className="mt-2" />
              </>
            ) : (
              <>
                <h2 className="arena-problem-title">{activeChallenge?.title}</h2>
                <div className="arena-badges">
                  <span className={`badge ${
                    activeChallenge?.difficulty === 'easy' ? 'bg-green'
                    : activeChallenge?.difficulty === 'medium' ? 'bg-yellow'
                    : 'bg-red'
                  }`}>
                    {activeChallenge?.difficulty}
                  </span>
                  <span className="badge bg-brand">+{activeChallenge?.xp_reward} XP</span>
                  {currentUser?.solved_questions.includes(activeChallenge?.id ?? -1) && (
                    <span className="badge bg-green">✓ Solved</span>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="arena-left-body">
            {challengeLoading ? (
              <>
                <Skeleton width="100%" height="14px" className="mb-2" />
                <Skeleton width="90%" height="14px" className="mb-2" />
                <Skeleton width="95%" height="14px" className="mb-2" />
              </>
            ) : (
              <div className="prose">
                {activeChallenge?.description.split('\n').map((line, i) => (
                  <p key={i}>{line}</p>
                ))}
              </div>
            )}

            <h3 className="test-cases-title">Verification Cases</h3>
            <div className="test-case-grid">
              {challengeLoading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="test-card">
                      <div className="test-header"><Skeleton width="120px" height="12px" /></div>
                      <div className="test-body">
                        <Skeleton width="80%" height="12px" />
                        <Skeleton width="60%" height="12px" />
                      </div>
                    </div>
                  ))
                : activeChallenge?.test_cases?.map((tc, idx) => (
                    <div key={idx} className="test-card" aria-label={`Test case ${idx + 1}`}>
                      <div className="test-header">Case {idx + 1}</div>
                      <div className="test-body">
                        <div><span className="text-muted">Input A:</span> <code className="font-mono">{String(tc.a)}</code></div>
                        <div><span className="text-muted">Input B:</span> <code className="font-mono">{String(tc.b)}</code></div>
                        <div className="test-expected">
                          <span className="text-muted">Expected:</span> <code className="font-mono text-green">{String(tc.expected)}</code>
                        </div>
                      </div>
                    </div>
                  ))
              }
            </div>
          </div>
        </div>

        {/* RIGHT: Editor + terminal */}
        <div className="arena-right" role="main" aria-label="Code editor">
          {/* Toolbar */}
          <div className="editor-header">
            <select
              value={language}
              onChange={e => {
                const lang = e.target.value as Language;
                setLanguage(lang);
                setCode(activeChallenge?.starter_code[lang] ?? '');
              }}
              className="select-dark"
              aria-label="Select programming language"
            >
              {LANGUAGES.map(l => (
                <option key={l.value} value={l.value}>{l.label}</option>
              ))}
            </select>

            <button
              className="btn-primary run-btn"
              onClick={runCode}
              disabled={executing || challengeLoading}
              aria-busy={executing}
              aria-label={executing ? 'Running code…' : 'Run code'}
            >
              {executing
                ? <><span className="spinner" aria-hidden="true" /> Evaluating…</>
                : '▶ Run Code'}
            </button>
          </div>

          {/* Monaco editor */}
          <div className="editor-body">
            <Editor
              height="100%"
              language={language === 'c' || language === 'cpp' ? 'cpp' : language}
              theme={theme === 'dark' ? 'vs-dark' : 'vs'}
              value={code}
              onChange={val => setCode(val ?? '')}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                padding: { top: 20 },
                fontFamily: "'JetBrains Mono', 'Menlo', 'Monaco', monospace",
                lineNumbersMinChars: 3,
                scrollBeyondLastLine: false,
              }}
            />
          </div>

          {/* Terminal */}
          <div className="console-panel" role="log" aria-label="Output terminal" aria-live="polite">
            <div className="console-header">
              <span className="console-dot red" aria-hidden="true" />
              <span className="console-dot yellow" aria-hidden="true" />
              <span className="console-dot green" aria-hidden="true" />
              <span className="console-label">System Terminal Output</span>
            </div>
            <pre className={`console-output ${outputClass}`}>
              {output || '> Awaiting execution commands…'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;