// src/app/layout/Sidebar.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React from "react";
import { Search, Bell } from "lucide-react";
import ShantazLogoSVG from "../../shared/components/ShantazLogoSVG.jsx";
import BrandLogo from "../../shared/components/BrandLogo.jsx";
import UserProfileMenu from "../../shared/components/UserProfileMenu.jsx";
import { navItems } from "./navItems.js";
import { SETTINGS_DEFAULTS } from "../../shared/settingsDefaults.js";

// ─── SIDEBAR ─────────────────────────────────────────────────────────────────

export function Sidebar({ activePage, setActivePage, collapsed, setCollapsed, badges = {}, canView, onSearchOpen, onNotifsOpen, notifCount = 0, settings = SETTINGS_DEFAULTS, mobileOpen = false, onMobileClose = () => {} }) {
  const visible = navItems.filter((item) => canView ? canView(item.id) : true);

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-60"} app-sidebar sidebar-slate${mobileOpen ? " is-open" : ""} no-print flex flex-col flex-shrink-0 transition-all duration-300 overflow-hidden relative`}
    >
      {/* ── Logo + Search/Notif ── */}
      <div className="px-3 pt-4 pb-3 flex-shrink-0 sb-divider">
        {!collapsed ? (
          <>
            {(() => {
              const name   = settings.companyName || "Shantaz Technofoods";
              const spaceI = name.indexOf(" ");
              const line1  = spaceI > 0 ? name.slice(0, spaceI).toUpperCase() : name.toUpperCase();
              const line2  = spaceI > 0 ? name.slice(spaceI + 1).toUpperCase() : "";
              const initial = name[0]?.toUpperCase() || "S";
              return (
                <div className="sb-brand mb-3">
                  <ShantazLogoSVG tone="dark" className="sb-logo-wide" />
                  <BrandLogo logo={settings.logo} size={64} rounded={14} />
                  <div className="min-w-0">
                    <div className="text-[13px] font-extrabold leading-none tracking-widest truncate sb-logo-name">{line1}</div>
                    {line2 && (
                      <div className="text-[9px] font-semibold leading-none tracking-widest mt-1.5 truncate sb-logo-sub">
                        {line2}
                      </div>
                    )}
                    <div className="sb-tagline">Innovation for Life</div>
                  </div>
                </div>
              );
            })()}
            <div className="flex items-center gap-1.5">
              <button onClick={onSearchOpen}
                className={`flex-1 flex items-center gap-1.5 px-2.5 py-2 rounded-lg text-[11px] transition-all sb-search${visible.length <= 1 ? " sb-search-staff" : ""}`}>
                <Search size={14} aria-hidden="true" className="opacity-70" /><span className="flex-1 text-left">Search</span>
                <kbd className="text-[9px] px-1.5 py-0.5 rounded sb-kbd">⌘K</kbd>
              </button>
              <button onClick={onNotifsOpen}
                className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all flex-shrink-0 sb-iconbtn">
                <Bell size={16} aria-hidden="true" />
                {notifCount > 0 && (
                  <span className="absolute -top-1 -right-1 text-[9px] font-black rounded-full flex items-center justify-center"
                        style={{ background: "#ef4444", color: "#ffffff", minWidth: 16, height: 16, padding: "0 3px", boxShadow: "0 2px 8px rgba(239,68,68,0.5)" }}>
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </button>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <BrandLogo logo={settings.logo} size={44} rounded={10} />
            <button onClick={onNotifsOpen} className="relative w-9 h-9 rounded-lg flex items-center justify-center transition-all sb-iconbtn">
              <Bell size={16} aria-hidden="true" />
              {notifCount > 0 && (
                <span className="absolute -top-1 -right-1 text-[9px] font-black rounded-full flex items-center justify-center"
                      style={{ background: "#ef4444", color: "#ffffff", minWidth: 15, height: 15, padding: "0 2px", boxShadow: "0 2px 6px rgba(239,68,68,0.5)" }}>
                  {notifCount > 9 ? "9+" : notifCount}
                </span>
              )}
            </button>
            <button onClick={onSearchOpen} className="w-9 h-9 rounded-lg flex items-center justify-center transition-all sb-iconbtn"><Search size={16} aria-hidden="true" /></button>
          </div>
        )}
      </div>

      {/* ── Nav (filtered by role) ── */}
      <nav className="flex-1 py-2 overflow-y-auto px-2 space-y-0.5">
        {visible.map((item) => {
          const isActive = activePage === item.id;
          return (
            <div key={item.id}>
              {item.section && !collapsed && (
                <div className="px-2.5 pt-5 pb-1.5 text-[9px] font-bold tracking-[0.13em] uppercase sb-section">{item.section}</div>
              )}
              <button onClick={() => setActivePage(item.id)}
                className={`sb-item w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg transition-all duration-150 relative ${isActive ? "is-active" : ""}`}>
                {isActive && <div className="sb-indicator" />}
                <div className={`sb-icon w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 transition-colors ${isActive ? "is-active" : ""}`}>
                  <item.Icon size={15} strokeWidth={isActive ? 2.4 : 2} aria-hidden="true" />
                  {/* Collapsed, the count has nowhere to sit — but an unread
                      WhatsApp message or a pending item still has to be
                      noticeable, so the number becomes a dot on the icon. */}
                  {collapsed && (badges[item.id] ?? item.badge) > 0 && (
                    <span className="absolute top-1 right-1 w-2 h-2 rounded-full"
                          style={{ background: "#ef4444", boxShadow: "0 0 0 2px var(--sb-bg, #0b1120)" }} />
                  )}
                </div>
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left text-[12.5px] font-medium tracking-[-0.01em]">
                      {item.label}
                    </span>
                    {(() => { const b = badges[item.id] ?? item.badge; return b > 0 ? (
                      <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full min-w-[18px] text-center leading-tight"
                            style={{
                              color: "#ffffff",
                              background: item.id==="pending" ? "linear-gradient(135deg,#f59e0b,#d97706)" : item.id==="pipeline" ? "linear-gradient(135deg,#818cf8,#6366f1)" : item.id==="machines" ? "linear-gradient(135deg,#5A78EA,#2640B0)" : "linear-gradient(135deg,#ef4444,#dc2626)",
                              boxShadow:  "0 2px 8px rgba(0,0,0,0.3)",
                            }}>{b}</span>
                    ) : null; })()}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </nav>

      {/* ── User Profile Menu ── */}
      <div className="px-3 pb-3 pt-2 relative sb-divider-top">
        <UserProfileMenu collapsed={collapsed} />
        <button onClick={() => setCollapsed(!collapsed)}
          className="sb-collapse mt-1 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg transition-all text-[9px] font-bold tracking-[0.08em] uppercase">
          {collapsed ? "▶" : <><span>◀</span><span>Collapse</span></>}
        </button>
      </div>
    </aside>
  );
}
