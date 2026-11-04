import React from "react";
import logoOnDark from "../assets/brand/shantaz-logo-on-dark.svg";

// The real SHANTAZ logo for dark surfaces (login stage, sidebar): gear, wheat,
// letters and ® traced from the owner's artwork in its own colours (black parts
// carry a thin light rim so they read on navy). The tagline is real text in a
// classic serif, spread letter by letter across exactly the width it has in the
// artwork — sharper than a trace at any size.
const TAGLINE = "INNOVATION FOR LIFE";

export default function ShantazLogo2D({ className = "", shine = false }) {
  return (
    <span className={`shz-logo ${shine ? "shz-shine" : ""} ${className}`} role="img" aria-label="SHANTAZ — Innovation for Life"
          style={shine ? { "--logo": `url("${logoOnDark}")` } : undefined}>
      <img src={logoOnDark} alt="" draggable={false} />
      <span className="shz-tag" aria-hidden="true">
        {TAGLINE.split("").map((c, i) => <span key={i}>{c === " " ? " " : c}</span>)}
      </span>
    </span>
  );
}
