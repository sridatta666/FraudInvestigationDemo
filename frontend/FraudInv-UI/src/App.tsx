import React, { useState, useEffect, useRef } from 'react';
import {
  ShieldAlert, Shield, Search, Cpu, Activity, FileText,
  MapPin, Clock, DollarSign, Globe, Play, CheckCircle,
  AlertTriangle, Download, TrendingUp, BarChart2,
  AlertOctagon, Timer, User, CreditCard, ChevronDown,
  ChevronUp, RefreshCw,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import FraudScoreGauge from './FraudScoreGauge';
import ThinkingPanel, { type ThinkingEntry } from './ThinkingPanel';
import { exportReport } from './exportReport';
import './App.css';

// ─── Types ───────────────────────────────────────────────────────────────────
interface AgentTiming {
  start: number;
  end?: number;
}

interface HistoryRecord {
  txnId: string;
  txn: any;
  events: any[];
  fraudScore: number | null;
  timestamp: Date;
  durationMs: number;
}

interface SessionStats {
  count: number;
  highRisk: number;
  scoreSum: number;
  timeSum: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function parseFraudScore(events: any[]): number | null {
  for (const e of events) {
    if (e.agent === 'Scorer' && e.output) {
      const m = e.output.match(/Fraud Score[:\s]+(\d+)/i);
      if (m) return Math.min(100, parseInt(m[1], 10));
    }
  }
  return null;
}

function heuristicRisk(txn: any): 'high' | 'medium' | 'low' {
  if (txn.amount > 10000 || (txn.is_international && txn.amount > 3000)) return 'high';
  if (txn.amount > 1000 || txn.is_international) return 'medium';
  return 'low';
}

function formatDuration(ms: number) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function getRiskClass(score: number) {
  if (score <= 35) return 'risk-low';
  if (score <= 70) return 'risk-medium';
  return 'risk-high';
}

// ─── Component ───────────────────────────────────────────────────────────────
function App() {
  const [transactions, setTransactions] = useState<any[]>([]);
  const [selectedTxn, setSelectedTxn] = useState<any | null>(null);
  const [investigating, setInvestigating] = useState(false);
  const [investigationDone, setInvestigationDone] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [agentTimings, setAgentTimings] = useState<Record<string, AgentTiming>>({});
  const [fraudScore, setFraudScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [stats, setStats] = useState<SessionStats>({ count: 0, highRisk: 0, scoreSum: 0, timeSum: 0 });
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [thinkingLog, setThinkingLog] = useState<ThinkingEntry[]>([]);

  const eventSourceRef = useRef<EventSource | null>(null);
  const startTimeRef = useRef<number>(0);
  const feedEndRef = useRef<HTMLDivElement | null>(null);
  // Mirrors events state so we can read the final list outside of a setState updater
  // (avoids React 18 Strict Mode double-invocation side-effect bug)
  const currentEventsRef = useRef<any[]>([]);

  // Fetch transactions on mount
  useEffect(() => {
    loadTransactions();
    return () => eventSourceRef.current?.close();
  }, []);

  // Auto-scroll feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  function loadTransactions() {
    setLoading(true);
    setFetchError(null);
    fetch('http://localhost:8000/api/transactions')
      .then(r => r.json())
      .then(data => { setTransactions(data); setLoading(false); })
      .catch(() => { setFetchError('Cannot reach backend. Is the server running?'); setLoading(false); });
  }

  function handleInvestigate() {
    if (!selectedTxn) return;
    setInvestigating(true);
    setInvestigationDone(false);
    setEvents([]);
    currentEventsRef.current = [];
    setAgentTimings({});
    setFraudScore(null);
    setStreamError(null);
    setThinkingLog([]);
    startTimeRef.current = Date.now();

    eventSourceRef.current?.close();
    const es = new EventSource(`http://localhost:8000/api/stream_investigation/${selectedTxn.id}`);
    eventSourceRef.current = es;

    es.onmessage = (evt: MessageEvent) => {
      const data = JSON.parse(evt.data);
      const now = Date.now();

      // Handle thinking tokens → live feed
      if (data.status === 'thinking') {
        setThinkingLog(prev => {
          const last = prev[prev.length - 1];
          if (last && last.agent === data.agent && !last.complete) {
            return [...prev.slice(0, -1), { ...last, text: last.text + data.token }];
          }
          return [...prev, { agent: data.agent, text: data.token, complete: false }];
        });
        return; // don't add thinking events to the pipeline feed
      }

      // Track per-agent timing
      if (data.status === 'processing') {
        setAgentTimings(prev => ({ ...prev, [data.agent]: { start: now } }));
      } else if (data.status === 'completed') {
        setAgentTimings(prev => ({
          ...prev,
          [data.agent]: { start: prev[data.agent]?.start ?? now, end: now },
        }));
        // Mark corresponding thinking entry as complete
        setThinkingLog(prev => {
          const last = prev[prev.length - 1];
          if (last && last.agent === data.agent && !last.complete) {
            return [...prev.slice(0, -1), { ...last, complete: true }];
          }
          return prev;
        });
        // Parse score as soon as scorer completes
        if (data.agent === 'Scorer' && data.output) {
          const m = data.output.match(/Fraud Score[:\s]+(\d+)/i);
          if (m) setFraudScore(Math.min(100, parseInt(m[1], 10)));
        }
      }

      setEvents(prev => {
        const idx = prev.findIndex(e => e.agent === data.agent && e.status === 'processing');
        let next: any[];
        if (idx >= 0 && data.status === 'completed') {
          next = [...prev];
          next[idx] = data;
        } else {
          next = [...prev, data];
        }
        currentEventsRef.current = next;
        return next;
      });

      if (data.status === 'finished') {
        es.close();
        setInvestigating(false);
        setInvestigationDone(true);
        const duration = Date.now() - startTimeRef.current;

        // Read final events from ref — avoids calling setStats/setHistory inside
        // a setEvents updater, which React 18 Strict Mode would double-invoke.
        const finalEvents = currentEventsRef.current;
        const score = parseFraudScore(finalEvents);
        setStats(s => ({
          count: s.count + 1,
          highRisk: s.highRisk + (score !== null && score > 70 ? 1 : 0),
          scoreSum: s.scoreSum + (score ?? 0),
          timeSum: s.timeSum + duration,
        }));
        setHistory(h => [{
          txnId: selectedTxn.id,
          txn: selectedTxn,
          events: finalEvents,
          fraudScore: score,
          timestamp: new Date(),
          durationMs: duration,
        }, ...h]);
      }

    };

    es.onerror = () => {
      es.close();
      setInvestigating(false);
      setStreamError('Stream disconnected. Click Retry to try again.');
    };
  }

  function getAgentIcon(agent: string) {
    switch (agent) {
      case 'Analyzer': return <Search size={18} />;
      case 'Scorer':   return <Activity size={18} />;
      case 'Advisor':  return <FileText size={18} />;
      case 'System':   return <Cpu size={18} />;
      default:         return <Shield size={18} />;
    }
  }

  const avgScore = stats.count > 0 ? Math.round(stats.scoreSum / stats.count) : null;
  const avgTime  = stats.count > 0 ? Math.round(stats.timeSum  / stats.count) : null;

  return (
    <div className="app-container">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="header glass-panel">
        <div className="header-brand">
          <div className="header-icon"><ShieldAlert size={26} /></div>
          <div>
            <h1>AuraGuard</h1>
            <p className="header-sub">AI-Powered Fraud Investigation Intelligence</p>
          </div>
        </div>

        <div className="stats-bar">
          <div className="stat-card">
            <BarChart2 size={16} className="stat-icon" />
            <span className="stat-value">{stats.count}</span>
            <span className="stat-label">Analyzed</span>
          </div>
          <div className="stat-card danger">
            <AlertOctagon size={16} className="stat-icon" />
            <span className="stat-value">{stats.highRisk}</span>
            <span className="stat-label">High Risk</span>
          </div>
          <div className="stat-card warning">
            <TrendingUp size={16} className="stat-icon" />
            <span className="stat-value">{avgScore ?? '—'}</span>
            <span className="stat-label">Avg Score</span>
          </div>
          <div className="stat-card accent">
            <Timer size={16} className="stat-icon" />
            <span className="stat-value">{avgTime !== null ? formatDuration(avgTime) : '—'}</span>
            <span className="stat-label">Avg Time</span>
          </div>
        </div>
      </header>

      {/* ── Dashboard ─────────────────────────────────────────────────── */}
      <div className={`dashboard-grid${investigating || thinkingLog.length > 0 ? ' has-thinking' : ''}`}>

        {/* Left Sidebar */}
        <aside className="transaction-selector glass-panel">
          <h2 className="section-title">
            <Activity size={18} style={{ color: 'var(--accent-primary)' }} />
            Live Queue
          </h2>

          <div className="txn-list">
            {loading ? (
              [1, 2, 3].map(i => (
                <div key={i} className="txn-card skeleton">
                  <div className="skel-line wide" />
                  <div className="skel-line short" />
                </div>
              ))
            ) : fetchError ? (
              <div className="sidebar-error">
                <AlertTriangle size={22} />
                <p>{fetchError}</p>
                <button className="btn-retry" onClick={loadTransactions}><RefreshCw size={14} /> Retry</button>
              </div>
            ) : (
              transactions.map(txn => {
                const risk = heuristicRisk(txn);
                return (
                  <div
                    key={txn.id}
                    className={`txn-card ${selectedTxn?.id === txn.id ? 'selected' : ''}`}
                    onClick={() => !investigating && setSelectedTxn(txn)}
                  >
                    <div className="txn-header">
                      <span className="txn-id">{txn.id}</span>
                      <div className="txn-header-right">
                        <span className={`risk-badge risk-${risk}`}>{risk.toUpperCase()}</span>
                        <span className="txn-amount">${txn.amount.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="txn-details">
                      <div className="txn-detail-item"><Clock size={12} /> {txn.time}</div>
                      <div className="txn-detail-item"><MapPin size={12} /> {txn.location}</div>
                      <div className="txn-detail-item span2"><Globe size={12} /> {txn.merchant}</div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <button
            className="btn-primary"
            disabled={!selectedTxn || investigating}
            onClick={handleInvestigate}
          >
            {investigating ? (
              <><div className="spin-dot" /> Investigating...</>
            ) : (
              <><Play size={16} fill="currentColor" /> Start Investigation</>
            )}
          </button>
        </aside>

        {/* Main Panel */}
        <main className="investigation-panel glass-panel">

          {/* Panel header */}
          <div className="panel-top">
            <h2 className="section-title">
              <Cpu size={18} style={{ color: 'var(--accent-primary)' }} />
              Agent Analysis Pipeline
            </h2>
            <div className="panel-actions">
              {history.length > 0 && (
                <button className="btn-ghost" onClick={() => setShowHistory(v => !v)}>
                  {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  History ({history.length})
                </button>
              )}
              {investigationDone && (
                <button className="btn-export" onClick={() => exportReport(selectedTxn, events, fraudScore)}>
                  <Download size={15} /> Export
                </button>
              )}
            </div>
          </div>

          {/* History drawer */}
          {showHistory && (
            <div className="history-drawer">
              {history.map((rec, i) => (
                <div key={i} className="history-item">
                  <span className="history-id">{rec.txnId}</span>
                  {rec.fraudScore !== null && (
                    <span className={`history-score ${getRiskClass(rec.fraudScore)}`}>
                      {rec.fraudScore}/100
                    </span>
                  )}
                  <span className="history-time">{rec.timestamp.toLocaleTimeString()}</span>
                  <span className="history-dur">{formatDuration(rec.durationMs)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Transaction detail panel */}
          {selectedTxn && (
            <div className="txn-detail-panel">
              <div className="txn-detail-grid">
                <div className="detail-item">
                  <CreditCard size={13} />
                  <span className="dl">ID</span>
                  <span className="dv">{selectedTxn.id}</span>
                </div>
                <div className="detail-item">
                  <DollarSign size={13} />
                  <span className="dl">Amount</span>
                  <span className="dv">${selectedTxn.amount.toLocaleString()} {selectedTxn.currency}</span>
                </div>
                <div className="detail-item">
                  <User size={13} />
                  <span className="dl">User</span>
                  <span className="dv">{selectedTxn.user_id} · {selectedTxn.user_country}</span>
                </div>
                <div className="detail-item">
                  <MapPin size={13} />
                  <span className="dl">Location</span>
                  <span className="dv">{selectedTxn.location}</span>
                </div>
                <div className="detail-item">
                  <Clock size={13} />
                  <span className="dl">Time</span>
                  <span className="dv">{selectedTxn.time}</span>
                </div>
                <div className="detail-item">
                  <Globe size={13} />
                  <span className="dl">International</span>
                  <span className={`dv ${selectedTxn.is_international ? 'text-warn' : 'text-ok'}`}>
                    {selectedTxn.is_international ? 'Yes ⚠' : 'No ✓'}
                  </span>
                </div>
              </div>
              {selectedTxn.note && (
                <div className="txn-note"><AlertTriangle size={12} /> {selectedTxn.note}</div>
              )}
            </div>
          )}

          {/* Fraud score gauge */}
          {fraudScore !== null && (
            <div className="score-section">
              <FraudScoreGauge score={fraudScore} />
            </div>
          )}

          {/* Empty state */}
          {!selectedTxn && events.length === 0 ? (
            <div className="empty-state">
              <ShieldAlert className="empty-icon" />
              <h3>No Transaction Selected</h3>
              <p>Pick a transaction from the Live Queue to start an AI investigation.</p>
            </div>
          ) : (
            <div className="pipeline-feed">
              {streamError && (
                <div className="stream-error">
                  <AlertTriangle size={18} />
                  <span>{streamError}</span>
                  <button className="btn-retry" onClick={handleInvestigate}>
                    <RefreshCw size={14} /> Retry
                  </button>
                </div>
              )}

              {events.map((event, idx) => {
                const timing = agentTimings[event.agent];
                const elapsed = timing?.end ? timing.end - timing.start : null;
                return (
                  <div key={idx} className="agent-node">
                    <div className={`agent-status-indicator ${event.status}`}>
                      <div className={`status-dot ${event.status}`}>
                        {event.status === 'completed' && (
                          <CheckCircle size={14} color="white" style={{ position: 'absolute', top: -1, left: -1 }} />
                        )}
                      </div>
                      {idx < events.length - 1 && <div className="status-line" />}
                    </div>

                    <div className={`agent-content ${event.status}`}>
                      <div className="agent-header">
                        <div className="agent-icon">{getAgentIcon(event.agent)}</div>
                        <span>{event.agent} Agent</span>
                        {elapsed !== null && (
                          <span className="agent-timing">{formatDuration(elapsed)}</span>
                        )}
                      </div>

                      {event.message && (
                        <div className="agent-message">{event.message}</div>
                      )}

                      {event.output && (
                        <div className="agent-output">
                          <ReactMarkdown>{event.output}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Awaiting next agent placeholder */}
              {investigating && events.length > 0 && events[events.length - 1].status === 'completed' && (
                <div className="agent-node" style={{ opacity: 0.5 }}>
                  <div className="agent-status-indicator processing">
                    <div className="status-dot processing" />
                  </div>
                  <div className="agent-content">
                    <div className="agent-message">Awaiting next agent...</div>
                  </div>
                </div>
              )}

              <div ref={feedEndRef} />
            </div>
          )}
        </main>

        {/* Right Sidebar – Live Thinking Feed */}
        {(investigating || thinkingLog.length > 0) && (
          <ThinkingPanel entries={thinkingLog} investigating={investigating} />
        )}
      </div>
    </div>

  );
}

export default App;
