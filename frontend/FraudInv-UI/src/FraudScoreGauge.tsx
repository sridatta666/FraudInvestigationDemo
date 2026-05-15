import React, { useEffect, useState } from 'react';

interface FraudScoreGaugeProps {
  score: number; // 0–100
}

function getColor(s: number) {
  if (s <= 35) return '#10b981';
  if (s <= 70) return '#f59e0b';
  return '#ef4444';
}

function getRiskLabel(s: number) {
  if (s <= 35) return 'LOW RISK';
  if (s <= 70) return 'MEDIUM RISK';
  return 'HIGH RISK';
}

const ARC_LENGTH = Math.PI * 54; // radius = 54

const FraudScoreGauge: React.FC<FraudScoreGaugeProps> = ({ score }) => {
  const [animated, setAnimated] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setAnimated(score), 120);
    return () => clearTimeout(t);
  }, [score]);

  const color = getColor(score);
  const offset = ARC_LENGTH * (1 - animated / 100);

  return (
    <div className="fraud-gauge">
      <svg viewBox="0 0 140 80" width="220" height="130">
        {/* Track */}
        <path
          d="M 14 74 A 56 56 0 0 1 126 74"
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {/* Filled arc */}
        <path
          d="M 14 74 A 56 56 0 0 1 126 74"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={ARC_LENGTH}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }}
        />
        {/* Score number */}
        <text
          x="70" y="62"
          textAnchor="middle"
          fontSize="26"
          fontWeight="700"
          fill={color}
          fontFamily="Outfit, sans-serif"
          style={{ transition: 'fill 0.5s ease' }}
        >
          {score}
        </text>
        <text x="70" y="74" textAnchor="middle" fontSize="9" fill="rgba(255,255,255,0.4)" fontFamily="Inter, sans-serif">
          / 100
        </text>
      </svg>
      <span className="gauge-label" style={{ color }}>
        {getRiskLabel(score)}
      </span>
    </div>
  );
};

export default FraudScoreGauge;
