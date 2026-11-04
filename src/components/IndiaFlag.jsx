import React from "react";

// Indian national flag, drawn to the official proportions: 3:2, three equal
// bands (India saffron #FF671F, white, India green #046A38) and the navy
// Ashoka Chakra with 24 spokes, its diameter 3/4 of the white band.
// Fixed aspect ratio — never stretched or cropped.
const SPOKES = Array.from({ length: 24 }, (_, i) => i * 15);

export default function IndiaFlag({ height = 14, className = "" }) {
  const w = (height * 3) / 2;
  return (
    <svg className={`india-flag ${className}`} width={w} height={height} viewBox="0 0 900 600" role="img" aria-label="Flag of India" preserveAspectRatio="xMidYMid meet">
      <rect width="900" height="200" fill="#FF671F" />
      <rect y="200" width="900" height="200" fill="#FFFFFF" />
      <rect y="400" width="900" height="200" fill="#046A38" />
      <g transform="translate(450 300)" fill="none" stroke="#06038D">
        <circle r="70" strokeWidth="10" />
        <circle r="12" fill="#06038D" stroke="none" />
        {SPOKES.map((a) => (
          <path key={a} d="M0 -12 L-4 -40 L0 -66 L4 -40 Z" fill="#06038D" stroke="none" transform={`rotate(${a})`} />
        ))}
      </g>
    </svg>
  );
}

export function MadeInIndia({ className = "" }) {
  return (
    <span className={`made-in-india ${className}`}>
      <IndiaFlag height={12} />
      <span>Proudly Made in India</span>
    </span>
  );
}
