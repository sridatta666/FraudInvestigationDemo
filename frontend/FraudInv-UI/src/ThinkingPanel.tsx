import React, { useRef, useEffect } from 'react';
import { Brain, Zap } from 'lucide-react';

export interface ThinkingEntry {
  agent: string;
  text: string;
  complete: boolean;
}

interface ThinkingPanelProps {
  entries: ThinkingEntry[];
  investigating: boolean;
}

function agentColor(agent: string): string {
  switch (agent) {
    case 'Analyzer': return '#6366f1';
    case 'Scorer':   return '#f59e0b';
    case 'Advisor':  return '#10b981';
    default:         return '#94a3b8';
  }
}

const ThinkingPanel: React.FC<ThinkingPanelProps> = ({ entries, investigating }) => {
  const feedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom as tokens stream in
  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries]);

  const activeEntry = entries.find(e => !e.complete);

  return (
    <aside className="thinking-panel glass-panel">
      <div className="thinking-header">
        <h2 className="section-title" style={{ marginBottom: 0 }}>
          <Brain size={18} style={{ color: 'var(--accent-primary)' }} />
          Agent Thinking
        </h2>
        {investigating && (
          <span className="live-badge">
            <span className="live-dot" />
            LIVE
          </span>
        )}
      </div>

      {activeEntry && (
        <div className="active-agent-pill" style={{ borderColor: agentColor(activeEntry.agent) }}>
          <Zap size={12} style={{ color: agentColor(activeEntry.agent) }} />
          <span style={{ color: agentColor(activeEntry.agent) }}>{activeEntry.agent}</span>
          <span className="thinking-ellipsis">thinking</span>
        </div>
      )}

      {entries.length === 0 ? (
        <div className="thinking-empty">
          <Brain size={32} style={{ opacity: 0.2 }} />
          <p>Token-level reasoning will stream here live during investigation.</p>
        </div>
      ) : (
        <div className="thinking-feed" ref={feedRef}>
          {entries.map((entry, i) => (
            <div key={i} className={`thinking-entry ${entry.complete ? 'complete' : 'active'}`}>
              <div className="thinking-agent-label" style={{ color: agentColor(entry.agent) }}>
                <span
                  className={`thinking-dot ${entry.complete ? '' : 'pulsing'}`}
                  style={{ background: agentColor(entry.agent) }}
                />
                {entry.agent}
              </div>
              <div className="thinking-text">
                {entry.text}
                {!entry.complete && <span className="thinking-cursor">▋</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
};

export default ThinkingPanel;
