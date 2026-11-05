// src/modules/whatsapp/WhatsAppPage.jsx — moved verbatim from the former single-file src/App.jsx
// (module-folder split, 2026-11-04). Behaviour is unchanged; see this folder's README.md.
import React, { useState, useEffect, useRef, useMemo } from "react";
import { RefreshCw, Settings, User, Menu, X, MessagesSquare, FileText, Sparkles, Search, Send, Paperclip, ArrowLeft, Check, CheckCheck, Clock, AlertCircle, MessageSquarePlus, Image as ImageIcon, Mic, FileDown, Trash2, Plus } from "lucide-react";
import { MobileNavContext } from "../../shared/components/PageHeader.jsx";
import { waAvatarColor, waParseDirectory, waPhoneKey, waReadSeen, waUnreadCount, waWriteSeen } from "./waHelpers.js";

// ─── WHATSAPP PAGE ───────────────────────────────────────────────────────────

// WhatsApp's own glyph is their trademark, so this is a plain speech bubble
// with a handset — the same idea, drawn here, nothing copied.
export function WaLogo({ size = 22 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 2.5A9.3 9.3 0 0 0 2.7 11.8c0 1.7.46 3.3 1.27 4.68L2.5 21.5l5.2-1.4a9.3 9.3 0 1 0 4.3-17.6Z"
            fill="#fff" opacity=".96" />
      <path d="M9.1 7.4c-.2-.45-.4-.46-.6-.47h-.5c-.17 0-.46.07-.7.33-.24.26-.92.9-.92 2.2s.94 2.55 1.07 2.73c.13.17 1.82 2.9 4.5 3.96 2.22.87 2.67.7 3.16.65.48-.04 1.56-.63 1.78-1.25.22-.62.22-1.15.16-1.26-.07-.11-.24-.17-.5-.3-.26-.13-1.56-.77-1.8-.86-.24-.09-.42-.13-.6.13-.17.26-.68.86-.83 1.04-.15.17-.3.2-.57.07-.26-.13-1.11-.41-2.12-1.31-.78-.7-1.31-1.56-1.47-1.82-.15-.26-.01-.4.12-.53.12-.12.26-.3.39-.46.13-.15.17-.26.26-.44.09-.17.04-.33-.02-.46-.07-.13-.58-1.43-.8-1.96Z"
            fill="#00a884" />
    </svg>
  );
}

export function WhatsAppPage({ settings = {}, onSave, canDo = () => false }) {
  const onMobileMenu = React.useContext(MobileNavContext);
  // Settings (incl. the API key), number book and Meta templates are admin
  // config. No "whatsapp" action exists in the role matrix, so reuse the
  // existing admin-config action (users.edit; super_admin always passes).
  const canEdit = canDo("users", "edit");
  const [localSettings, setLocalSettings] = useState({
    waApiKey: settings.waApiKey || "",
    waPhoneId: settings.waPhoneId || "",
    waWabaId: settings.waWabaId || "",
    waPluginId: settings.waPluginId || "",
    waOwnerPhone: settings.waOwnerPhone || "",
    waGroupNumbers: settings.waGroupNumbers || "",
    // Names for the numbers in waGroupNumbers — see waParseDirectory.
    waDirectory: settings.waDirectory || "",
    waAnthropicKey: settings.waAnthropicKey || "",
    // Gemini powers the auto-reply agent. Chosen over Anthropic because it
    // reads text, images AND audio natively — a voice note needs no separate
    // speech-to-text service.
    waGeminiKey: settings.waGeminiKey || "",
    // Training the operator gives the agent ("if someone asks X, answer Y").
    // Lives in the same settings row so the server-side webhook can read it.
    waAgentTraining: settings.waAgentTraining || "",
    waAutoReply: settings.waAutoReply || false,
    // Approved template the alerts are sent with (see waDispatch).
    waAlertTemplate: settings.waAlertTemplate || "",
    waAlertTemplateLang: settings.waAlertTemplateLang || "",
    // The training as a list (JSON array of strings). waAgentTraining above is
    // derived from it — that plain text is what the webhook reads.
    waAgentRules: settings.waAgentRules || "",
    waNotifyIssue: settings.waNotifyIssue !== false,
    waNotifyTransfer: settings.waNotifyTransfer !== false,
    waNotifyDeadline: settings.waNotifyDeadline !== false,
    waNotifyDaily: settings.waNotifyDaily || false,
  });
  const [msgLog, setMsgLog] = useState(() => {
    try { return JSON.parse(localStorage.getItem("erp_wa_log") || "[]"); } catch { return []; }
  });
  const [testStatus, setTestStatus] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [section, setSection] = useState("chats"); // chats | templates | training | settings | log

  // ── Live inbox ──
  // Conversations are READ FROM CHAKRA HQ, not stored here. Chakra is already
  // the system of record for everything the business number sends and receives,
  // so mirroring it into our own table would only create a second copy that can
  // drift. That is why this needs no webhook and no migration.
  const [chats,        setChats]        = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatsErr,     setChatsErr]     = useState("");
  const [activeChat,   setActiveChat]   = useState(null);
  const [messages,     setMessages]     = useState([]);
  const [msgsLoading,  setMsgsLoading]  = useState(false);
  const [msgsErr,      setMsgsErr]      = useState("");
  const [reply,        setReply]        = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [chatSearch,   setChatSearch]   = useState("");
  const threadEndRef = useRef(null);

  // Which conversations have been read, and which are hidden from this inbox.
  const [seen,       setSeen]       = useState(() => waReadSeen());
  // Downloaded attachments, keyed by "<messageId>:<index>". Fetched lazily and
  // held for the session only: a data: URL in React state costs nothing once
  // the thread is closed, and caching photos to disk is not ours to decide.
  const [media, setMedia] = useState({});
  // Starting a conversation from the ERP instead of waiting to be messaged.
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo,   setComposeTo]   = useState("");

  // Setups that predate the number book already have a comma list of digits.
  // Those numbers become rows with an empty name rather than disappearing, so
  // the first time this screen opens the existing recipients are all there
  // waiting to be named.
  const directory = useMemo(() => {
    const saved = waParseDirectory(localSettings.waDirectory);
    if (saved.length) return saved;
    return String(localSettings.waGroupNumbers || "")
      .split(",").map((s) => s.trim()).filter(Boolean)
      .map((phone) => ({ name: "", phone, dept: "" }));
  }, [localSettings.waDirectory, localSettings.waGroupNumbers]);

  // phone (last 10 digits) -> { name, dept }
  const phoneBook = useMemo(() => {
    const map = {};
    directory.forEach((p) => { const k = waPhoneKey(p?.phone); if (k) map[k] = p; });
    const ownerKey = waPhoneKey(localSettings.waOwnerPhone);
    if (ownerKey && !map[ownerKey]) map[ownerKey] = { name: "You (owner)", dept: "" };
    return map;
  }, [directory, localSettings.waOwnerPhone]);

  // The ERP's own name for a number always beats whatever the sender set as
  // their WhatsApp display name — "Rajesh · Packing" is useful, "Raju bhai 🔥"
  // is not.
  const whoIs = (phone, fallback = "") => {
    const hit = phoneBook[waPhoneKey(phone)];
    if (hit?.name) return { name: hit.name, dept: hit.dept || "", known: true };
    return { name: fallback || phone || "Unknown", dept: "", known: false };
  };

  const unread = useMemo(() => waUnreadCount(chats, seen), [chats, seen]);

  // What the list actually shows: hidden conversations dropped unless asked
  // for, then the search applied over the ERP's name, the department AND the
  // digits — searching "packing" should find the packing supervisor even though
  // Chakra has never heard the word.
  const visibleChats = useMemo(() => {
    const q = chatSearch.trim().toLowerCase();
    return chats.filter((c) => {
      if (!q) return true;
      const who = phoneBook[waPhoneKey(c.phone)] || {};
      return [who.name, who.dept, c.name, c.phone]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
    });
  }, [chats, chatSearch, phoneBook]);

  // ── Settings state ──
  // revealKey decides whether a saved secret shows as "Saved · …abc123" or as
  // an editable box. A password field full of dots looks the same whether a
  // key is stored or not, which is how a half-saved setup went unnoticed.
  const [revealKey, setRevealKey] = useState({});
  const [saveNote,  setSaveNote]  = useState("");
  const [connCheck, setConnCheck] = useState(null); // null | checking | ok | bad

  // ── Message templates ──
  // A template is what lets the ERP START a conversation. Alerts fire at times
  // nobody is chatting, so without an approved template every outbound alert is
  // rejected by WhatsApp. Created here and submitted to Meta for approval.
  const [templates,    setTemplates]    = useState([]);
  const [tplLoading,   setTplLoading]   = useState(false);
  const [tplErr,       setTplErr]       = useState("");
  const [tplCreating,  setTplCreating]  = useState(false);
  const [tplMsg,       setTplMsg]       = useState("");
  const [showNewTpl,   setShowNewTpl]   = useState(false);
  // Custom template form: null when closed, otherwise
  // { mode: "create"|"edit", id, name, category, language, body, examples: [] }
  const [tplForm,      setTplForm]      = useState(null);
  const [tplBusy,      setTplBusy]      = useState("");   // "<action>:<name>" while a call runs
  const [tplConfirm,   setTplConfirm]   = useState("");   // name awaiting delete confirmation

  // ── AI training ──
  // Saved training. The settings row wins over localStorage: it is what the
  // server-side webhook reads, and it follows the operator across devices.
  const [trainingData, setTrainingData] = useState(() => {
    if (settings.waAgentTraining) return settings.waAgentTraining;
    try { return localStorage.getItem("erp_wa_training") || ""; } catch { return ""; }
  });
  const [ruleEdit,     setRuleEdit]     = useState(null);   // { i, text } while a rule is being edited
  const [newRule,      setNewRule]      = useState("");
  const [clearAsk,     setClearAsk]     = useState(false);
  // Interview: the agent asks, the owner picks an answer.
  const [iv, setIv] = useState({ loading: false, err: "", q: null, custom: "" });
  const [ivAsked, setIvAsked] = useState(() => {
    try { const v = JSON.parse(localStorage.getItem("erp_wa_asked") || "[]"); return Array.isArray(v) ? v : []; } catch { return []; }
  });
  // Test: what the live auto-reply would answer, without sending anything.
  const [tst, setTst] = useState({ msg: "", loading: false, reply: "", err: "" });

  const upd = (key, val) => { setLocalSettings((p) => ({ ...p, [key]: val })); setDirty(true); };

  const handleSave = () => {
    if (!canEdit) return;
    if (onSave) onSave({ ...settings, ...localSettings });
    setDirty(false);
    setRevealKey({});
    setSaveNote("Saved");
    setTimeout(() => setSaveNote(""), 3000);
  };

  // What is still missing before anything can work. Named in the operator's
  // words, not ours — "API key", not "waApiKey".
  const setupMissing = [
    !localSettings.waApiKey   && "API key",
    !localSettings.waPluginId && "Plugin ID",
    !localSettings.waPhoneId  && "Phone number ID",
    !localSettings.waOwnerPhone && "your number",
  ].filter(Boolean);

  const deptNumbers = String(localSettings.waGroupNumbers || "")
    .split(",").map((s) => s.trim()).filter(Boolean);

  // The number book is the thing the operator edits; waGroupNumbers is derived
  // from it on every change. Keeping that plain comma string in sync means the
  // alert sender (and the deadline watcher in App) keep reading exactly what
  // they always have — no migration, no second code path to get wrong.
  const writeDirectory = (rows) => {
    setLocalSettings((p) => ({
      ...p,
      waDirectory:    JSON.stringify(rows),
      waGroupNumbers: rows.map((r) => String(r?.phone || "").trim()).filter(Boolean).join(", "),
    }));
    setDirty(true);
  };
  const setDirRow    = (i, patch) => writeDirectory(directory.map((r, j) => j === i ? { ...r, ...patch } : r));
  const addDirRow    = ()         => writeDirectory([...directory, { name: "", phone: "", dept: "" }]);
  const removeDirRow = (i)        => writeDirectory(directory.filter((_, j) => j !== i));

  // A real call to Chakra, not a check that the boxes are non-empty. The old
  // badge said "Connected" for a wrong key, which is worse than saying nothing.
  const checkConnection = async () => {
    if (!localSettings.waApiKey) return;
    setConnCheck("checking");
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-chats", { apiKey: localSettings.waApiKey });
      setConnCheck(res?.success ? "ok" : "bad");
      if (res?.success) setChats(res.chats || []);
    } catch {
      setConnCheck("bad");
    }
  };

  const handleTest = async () => {
    if (!localSettings.waApiKey || !localSettings.waOwnerPhone) return;
    setTestStatus("sending");
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-send", {
        to: localSettings.waOwnerPhone,
        message: "✅ Shantaz ERP — WhatsApp connected successfully!",
        apiKey: localSettings.waApiKey,
        pluginId: localSettings.waPluginId || "",
        phoneId: localSettings.waPhoneId || "",
      });
      if (res?.success) {
        setTestStatus("success");
        logWaMessage(localSettings.waOwnerPhone, "Test message", "sent");
      } else {
        setTestStatus("fail");
        logWaMessage(localSettings.waOwnerPhone, "Test message", "failed");
      }
    } catch (e) {
      setTestStatus("fail");
      logWaMessage(localSettings.waOwnerPhone, "Test message", "failed");
    }
    setTimeout(() => setTestStatus(null), 4000);
  };

  // ── Inbox loaders ───────────────────────────────────────────────────────
  // quiet=true is the 25-second background poll: no spinner, and a failed poll
  // does not paint an error over a list that is still perfectly good.
  const loadChats = async (quiet = false) => {
    if (!localSettings.waApiKey) { setChatsErr("Add the API key in Settings first"); return; }
    if (!quiet) { setChatsLoading(true); setChatsErr(""); }
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-chats", { apiKey: localSettings.waApiKey });
      if (res?.success) setChats(res.chats || []);
      else if (!quiet) setChatsErr(res?.error || "Could not load chats");
    } catch (e) {
      if (!quiet) setChatsErr(e?.message || "Connection failed");
    }
    if (!quiet) setChatsLoading(false);
  };

  // quiet=true is the background refresh of an already-open thread: it must not
  // blank the messages or flash a spinner, or reading a long conversation would
  // jump back to the top every few seconds.
  const openChat = async (chat, quiet = false) => {
    if (!quiet) {
      setActiveChat(chat);
      setMessages([]); setMsgsErr(""); setMsgsLoading(true);
    }
    // Opening a thread marks it read up to its newest message.
    setSeen((prev) => {
      const next = { ...prev, [chat.id]: Math.max(Number(chat.lastTs || 0), Number(prev[chat.id] || 0)) };
      waWriteSeen(next);
      return next;
    });
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-messages", { apiKey: localSettings.waApiKey, chatId: chat.id });
      if (res?.success) {
        // An optimistic bubble whose send has not come back yet would vanish on
        // a background refresh, so still-sending messages are kept on top.
        setMessages((prev) => {
          const pending = prev.filter((m) => m.status === "sending");
          return [...(res.messages || []), ...pending];
        });
      } else if (!quiet) setMsgsErr(res?.error || "Could not load messages");
    } catch (e) {
      if (!quiet) setMsgsErr(e?.message || "Connection failed");
    }
    if (!quiet) setMsgsLoading(false);
  };


  // Attachments are fetched one at a time, on demand, through the server-side
  // proxy — the API key needed to download them must never reach the browser.
  // att carries a WhatsApp media id, a hosted file URL, or both; the proxy
  // tries whichever it is given. force=true is the Retry button.
  const loadMedia = async (key, att, force = false) => {
    if (!att || (!att.mediaId && !att.url)) return;
    if (media[key] && !force) return;
    setMedia((p) => ({ ...p, [key]: { loading: true } }));
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-media", { apiKey: localSettings.waApiKey, mediaId: att.mediaId || "", url: att.url || "" });
      setMedia((p) => ({ ...p, [key]: res?.success ? { url: res.dataUrl, mimeType: res.mimeType } : { err: res?.error || "Could not load" } }));
    } catch (e) {
      setMedia((p) => ({ ...p, [key]: { err: e?.message || "Could not load" } }));
    }
  };

  // Start a conversation with a number that has not messaged us. WhatsApp only
  // allows this inside a 24-hour window opened by THEIR message, so if the
  // number is new the first message has to be an approved template — which the
  // compose box says plainly rather than letting the send fail silently.
  const startChat = async () => {
    const digits = composeTo.replace(/[^0-9]/g, "");
    if (digits.length < 10) return;
    const existing = chats.find((c) => waPhoneKey(c.phone) === waPhoneKey(digits));
    setComposeOpen(false); setComposeTo("");
    if (existing) { openChat(existing); return; }
    // No conversation yet: show a thread that exists only in the browser until
    // the first message actually goes out.
    const who = whoIs(digits);
    setActiveChat({ id: `new-${digits}`, phone: digits, name: who.name, lastTs: 0, isNew: true });
    setMessages([]); setMsgsErr("");
  };

  // Replying to someone who just messaged is a SESSION message, which WhatsApp
  // allows because their own message opened the 24-hour window. No approved
  // template is needed here — that is only required to start a conversation.
  const sendReply = async () => {
    const text = reply.trim();
    if (!text || sendingReply || !activeChat?.phone) return;
    setSendingReply(true);
    const optimistic = { id: `tmp-${Date.now()}`, text, direction: "outbound", status: "sending", ts: Date.now() };
    setMessages((prev) => [...prev, optimistic]);
    setReply("");
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-send", {
        to: activeChat.phone,
        message: text,
        apiKey: localSettings.waApiKey,
        pluginId: localSettings.waPluginId || "",
        phoneId: localSettings.waPhoneId || "",
      });
      setMessages((prev) => prev.map((m) => m.id === optimistic.id
        ? { ...m, status: res?.success ? "sent" : "failed" }
        : m));
      if (!res?.success) setMsgsErr(res?.error || "Message was not sent");
      else {
        logWaMessage(activeChat.phone, text, "sent");
        // A conversation started from the ERP has no Chakra chat id until the
        // first message lands, so the list is pulled again and the placeholder
        // thread swapped for the real one.
        if (activeChat.isNew) {
          setTimeout(async () => {
            await loadChats(true);
            setChats((cur) => {
              const real = cur.find((c) => waPhoneKey(c.phone) === waPhoneKey(activeChat.phone));
              if (real) setActiveChat(real);
              return cur;
            });
          }, 1500);
        }
      }
    } catch (e) {
      setMessages((prev) => prev.map((m) => m.id === optimistic.id ? { ...m, status: "failed" } : m));
      setMsgsErr(e?.message || "Send failed");
    }
    setSendingReply(false);
  };

  // Pull the inbox when the Chats tab opens and a key is configured.
  useEffect(() => {
    if (section === "chats" && localSettings.waApiKey && chats.length === 0 && !chatsLoading && !chatsErr) {
      loadChats();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, localSettings.waApiKey]);

  useEffect(() => {
    if (threadEndRef.current) threadEndRef.current.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Messages arrive on the server whether or not anyone is looking at this
  // page, so the inbox refreshes itself. Previously a new message only appeared
  // if someone thought to press Refresh — which, for an alerting tool, is the
  // one thing it must not require.
  //
  // Paused while the browser tab is hidden: a factory laptop can sit on this
  // page all day, and polling a background tab is a call nobody will read.
  useEffect(() => {
    if (section !== "chats" || !localSettings.waApiKey) return;
    const tick = () => { if (!document.hidden) loadChats(true); };
    const t = setInterval(tick, 25000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, localSettings.waApiKey]);

  // The open conversation refreshes faster — this is where a reply is being
  // waited for.
  useEffect(() => {
    if (section !== "chats" || !activeChat?.id || activeChat.isNew) return;
    const t = setInterval(() => { if (!document.hidden) openChat(activeChat, true); }, 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, activeChat?.id]);

  // Photos load by themselves, the way they do on a phone — a fault photo that
  // needs a click to appear is a fault photo nobody looks at. Capped at the
  // twelve most recent, so opening a long thread does not pull down 200 images,
  // and only images: a voice note or a PDF waits to be asked for.
  useEffect(() => {
    if (!activeChat?.id) return;
    const wanted = [];
    messages.forEach((m, mi) => (m.attachments || []).forEach((a, ai) => {
      if (a.kind === "image" && (a.mediaId || a.url)) wanted.push([`${m.id || mi}:${ai}`, a]);
    }));
    wanted.slice(-12).forEach(([key, att]) => { if (!media[key]) loadMedia(key, att); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, activeChat?.id]);

  // When the last inbound message is older than 24 hours, WhatsApp's session
  // window has closed and a plain text reply WILL be rejected by Meta. Saying
  // so before the send is the difference between a clear rule and a mystery.
  const sessionOpen = useMemo(() => {
    const inbound = messages.filter((m) => m.direction === "inbound");
    if (!inbound.length) return false;
    const newest = Math.max(...inbound.map((m) => Number(m.ts || 0)));
    const ms = newest < 1e12 ? newest * 1000 : newest;
    return Date.now() - ms < 24 * 60 * 60 * 1000;
  }, [messages]);

  // A thread left open should not keep showing an unread mark as new messages
  // land in it.
  useEffect(() => {
    if (!activeChat?.id || !messages.length) return;
    const newest = Math.max(...messages.map((m) => Number(m.ts || 0)));
    if (!newest) return;
    setSeen((prev) => {
      if (Number(prev[activeChat.id] || 0) >= newest) return prev;
      const next = { ...prev, [activeChat.id]: newest };
      waWriteSeen(next);
      return next;
    });
  }, [messages, activeChat?.id]);

  // ── Template loaders ────────────────────────────────────────────────────
  const loadTemplates = async () => {
    if (!localSettings.waApiKey) { setTplErr("Add the API key in Settings first"); return; }
    if (!localSettings.waWabaId) { setTplErr("Add the WABA ID in Settings first"); return; }
    setTplLoading(true); setTplErr(""); setTplMsg("");
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-templates", {
        action: "list", apiKey: localSettings.waApiKey, wabaId: localSettings.waWabaId,
      });
      if (res?.success) setTemplates(res.templates || []);
      else setTplErr(res?.error || "Could not load templates");
    } catch (e) {
      setTplErr(e?.message || "Connection failed");
    }
    setTplLoading(false);
  };

  // The one template that covers every ERP alert. The {{n}} slots let a single
  // approved template carry an issue, a transfer and a deadline alert, so we
  // don't need Meta to approve one per alert type.
  const ERP_ALERT_TEMPLATE = {
    name: "shantaz_erp_alert",
    category: "UTILITY",
    language: "en",
    components: [
      {
        // Meta rejects a template whose variables outweigh its fixed text
        // ("too many variables for its length"), so the wording around the
        // five slots is deliberately full sentences rather than bare labels.
        type: "BODY",
        text:
          "Shantaz Technofoods - Production Update\n\n" +
          "There is a new update on the production floor that needs your attention.\n\n" +
          "Update type: {{1}}\n" +
          "Machine: {{2}}\n" +
          "Department: {{3}}\n" +
          "Details: {{4}}\n" +
          "Recorded at: {{5}}\n\n" +
          "This message was sent automatically by the Shantaz Technofoods production system. " +
          "Please check the machine in your department and take the necessary action. " +
          "If you need any help with this update, simply reply to this message.",
        example: { body_text: [["Issue Raised", "KM10 (SN-1234)", "Mechanical", "Pump leak", "30 Oct, 10:54 AM"]] },
      },
    ],
  };

  const createAlertTemplate = async () => {
    if (!canEdit) return;
    if (!localSettings.waApiKey || !localSettings.waWabaId) {
      setTplErr("Add the API key and WABA ID in Settings first"); return;
    }
    setTplCreating(true); setTplErr(""); setTplMsg("");
    try {
      const { callWhatsAppFn } = await import("../../stores/adminApi.js");
      const res = await callWhatsAppFn("whatsapp-templates", {
        action: "create",
        apiKey: localSettings.waApiKey,
        wabaId: localSettings.waWabaId,
        template: ERP_ALERT_TEMPLATE,
      });
      if (res?.success) {
        setTplMsg(`Template sent for approval — status: ${res.status || "PENDING"}. Meta usually decides within minutes, at most 24 hours.`);
        setShowNewTpl(false);
        loadTemplates();
      } else {
        setTplErr(res?.error || "Template was not created");
      }
    } catch (e) {
      setTplErr(e?.message || "Create failed");
    }
    setTplCreating(false);
  };

  // {{1}}, {{2}}… in a body, as the ordered list of slot numbers.
  const tplSlots = (text = "") =>
    [...new Set((String(text).match(/\{\{(\d+)\}\}/g) || []).map((m) => Number(m.replace(/\D/g, ""))))].sort((a, b) => a - b);
  // The body with its sample values written in, so the operator reads the
  // message the way a recipient will — not a row of {{n}}.
  const tplFill = (text = "", values = []) =>
    String(text).replace(/\{\{(\d+)\}\}/g, (m, n) => (values[Number(n) - 1] ? values[Number(n) - 1] : m));

  // Alerts fill exactly five slots (type, machine, department, details, time),
  // so only a template with {{1}}..{{5}} can carry them.
  const tplFitsAlerts = (t) => tplSlots(t?.text).join(",") === "1,2,3,4,5";

  // Saves just this change on top of what is already saved. Anything still
  // being typed on the Settings tab stays unsaved, as the operator left it.
  const persist = (patch) => {
    if (!canEdit) return;
    setLocalSettings((p) => ({ ...p, ...patch }));
    if (onSave) onSave({ ...settings, ...patch });
  };

  const chooseAlertTemplate = (t) => {
    persist({ waAlertTemplate: t.name, waAlertTemplateLang: t.language || "en" });
    setTplErr(""); setTplMsg(`All alerts will now be sent with "${t.name}".`);
  };
  const stopTemplateForAlerts = () => {
    persist({ waAlertTemplate: "", waAlertTemplateLang: "" });
    setTplErr(""); setTplMsg("Alerts will now be sent as plain messages.");
  };

  // Sends the template, filled with its own sample values, to the owner's
  // number — the only honest way to know an approved template really arrives.
  const testTemplate = async (t) => {
    if (!localSettings.waOwnerPhone) { setTplErr("Add your number in Settings — the test is sent there"); return; }
    setTplBusy(`test:${t.name}`); setTplErr(""); setTplMsg("");
    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
    const res = await callWhatsAppFn("whatsapp-send", {
      to: localSettings.waOwnerPhone,
      apiKey: localSettings.waApiKey, pluginId: localSettings.waPluginId || "", phoneId: localSettings.waPhoneId || "",
      template: { name: t.name, language: t.language || "en", params: t.example || [] },
    });
    if (res?.success) setTplMsg(`Test of "${t.name}" sent to your number — check WhatsApp.`);
    else setTplErr(res?.error || "Test was not sent");
    setTplBusy("");
  };

  const deleteTemplate = async (t) => {
    if (!canEdit) return;
    setTplBusy(`delete:${t.name}`); setTplErr(""); setTplMsg(""); setTplConfirm("");
    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
    const res = await callWhatsAppFn("whatsapp-templates", {
      action: "delete", apiKey: localSettings.waApiKey, wabaId: localSettings.waWabaId, name: t.name,
    });
    if (res?.success) {
      if (localSettings.waAlertTemplate === t.name) persist({ waAlertTemplate: "", waAlertTemplateLang: "" });
      setTemplates((prev) => prev.filter((x) => x.name !== t.name));
      setTplMsg(`"${t.name}" deleted.`);
    } else setTplErr(res?.error || "Delete failed");
    setTplBusy("");
  };

  const openTplForm = (t) => {
    setTplErr(""); setTplMsg(""); setShowNewTpl(false);
    setTplForm(t
      ? { mode: "edit", id: t.id, name: t.name, category: t.category || "UTILITY", language: t.language || "en", body: t.text || "", examples: [...(t.example || [])] }
      : { mode: "create", id: "", name: "", category: "UTILITY", language: "en", body: "", examples: [] });
  };

  // What Meta will reject, caught before the round trip and said in words.
  const tplFormProblem = (() => {
    if (!tplForm) return "";
    if (tplForm.mode === "create" && !/^[a-z0-9_]{1,512}$/.test(tplForm.name)) return "Name: lowercase letters, numbers and _ only (e.g. daily_stock_update)";
    if (!tplForm.body.trim()) return "Write the message";
    const slots = tplSlots(tplForm.body);
    if (slots.some((n, i) => n !== i + 1)) return "Placeholders must be in order: {{1}}, {{2}}, {{3}}…";
    if (slots.some((n) => !String(tplForm.examples[n - 1] || "").trim())) return "Add a sample value for every placeholder — Meta reviews with these";
    if (/^\s*\{\{|\}\}\s*$/.test(tplForm.body)) return "The message cannot start or end with a placeholder";
    return "";
  })();

  const saveTplForm = async () => {
    if (!canEdit || !tplForm || tplFormProblem) return;
    const slots = tplSlots(tplForm.body);
    const bodyComp = { type: "BODY", text: tplForm.body };
    if (slots.length) bodyComp.example = { body_text: [slots.map((n) => String(tplForm.examples[n - 1]).trim())] };
    setTplCreating(true); setTplErr(""); setTplMsg("");
    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
    const res = await callWhatsAppFn("whatsapp-templates", tplForm.mode === "edit"
      ? { action: "edit", apiKey: localSettings.waApiKey, wabaId: localSettings.waWabaId, templateId: tplForm.id, template: { components: [bodyComp] } }
      : { action: "create", apiKey: localSettings.waApiKey, wabaId: localSettings.waWabaId,
          template: { name: tplForm.name, category: tplForm.category, language: tplForm.language, components: [bodyComp] } });
    if (res?.success) {
      setTplMsg(tplForm.mode === "edit"
        ? `"${tplForm.name}" updated — Meta will review it again.`
        : `"${tplForm.name}" sent to Meta — approval takes minutes, at most 24 hours.`);
      setTplForm(null);
      loadTemplates();
    } else setTplErr(res?.error || "Template was not saved");
    setTplCreating(false);
  };

  useEffect(() => {
    if (section === "templates" && localSettings.waApiKey && localSettings.waWabaId
        && templates.length === 0 && !tplLoading && !tplErr) {
      loadTemplates();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, localSettings.waApiKey, localSettings.waWabaId]);

  // Chakra sends seconds on some rows and milliseconds on others, so normalise
  // before formatting — otherwise half the timestamps land in 1970.
  const waDate = (ts) => {
    if (!ts) return null;
    const n = Number(ts);
    if (!n) return null;
    const d = new Date(n < 1e12 ? n * 1000 : n);
    return isNaN(d.getTime()) ? null : d;
  };

  // Chat-list stamp: today shows a clock, this week a weekday, older a date —
  // the same shorthand WhatsApp uses.
  const waTime = (ts) => {
    const d = waDate(ts);
    if (!d) return "";
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    const days = Math.round((now.setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 1) return "Yesterday";
    if (days < 7)   return d.toLocaleDateString("en-IN", { weekday: "short" });
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
  };

  const waClock = (ts) => {
    const d = waDate(ts);
    return d ? d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "";
  };

  // Day separator chip inside the thread.
  const waDayLabel = (ts) => {
    const d = waDate(ts);
    if (!d) return "";
    const now = new Date();
    const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0) return "Today";
    if (days === 1) return "Yesterday";
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  };

  const logWaMessage = (to, message, status) => {
    const entry = { to, message, status, time: new Date().toISOString() };
    setMsgLog((prev) => {
      const next = [entry, ...prev].slice(0, 200);
      try { localStorage.setItem("erp_wa_log", JSON.stringify(next)); } catch {}
      return next;
    });
  };

  useEffect(() => {
    window.__waLog = logWaMessage;
    return () => { delete window.__waLog; };
  }, []);

  // ── AI training ─────────────────────────────────────────────────────────
  // Training used to be every line the operator ever typed into a chat,
  // glued into one blob — including "Training शुरू करो" — with no way to see
  // or fix a single instruction. It is now a list of rules, one instruction
  // each. The webhook still reads the same waAgentTraining text, derived from
  // the list on every change, so the live auto-reply needs no change.
  const rules = useMemo(() => {
    try {
      const v = JSON.parse(localSettings.waAgentRules || "null");
      if (Array.isArray(v)) return v.map(String);
    } catch {}
    // First open after the change: the old blob becomes one rule per line,
    // ready to be cleaned up rather than silently lost.
    return String(trainingData || "").split("\n").map((l) => l.replace(/^\s*-\s*/, "").trim()).filter(Boolean);
  }, [localSettings.waAgentRules, trainingData]);

  const writeRules = (list) => {
    const clean = list.map((r) => String(r).trim()).filter(Boolean);
    const text = clean.map((r) => `- ${r}`).join("\n");
    setTrainingData(text);
    try { localStorage.setItem("erp_wa_training", text); } catch {}
    persist({ waAgentRules: JSON.stringify(clean), waAgentTraining: text });
  };
  const addRule = (text) => { if (String(text).trim()) writeRules([...rules, text]); };

  const nextQuestion = async () => {
    if (!localSettings.waGeminiKey) { setIv((v) => ({ ...v, err: "Add the Gemini key in Settings first" })); return; }
    setIv({ loading: true, err: "", q: null, custom: "" });
    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
    const res = await callWhatsAppFn("whatsapp-agent", {
      mode: "interview", geminiKey: localSettings.waGeminiKey, trainingData, asked: ivAsked,
    });
    if (res?.success) {
      setIv({ loading: false, err: "", q: { situation: res.situation, question: res.question, options: res.options }, custom: "" });
      setIvAsked((prev) => {
        const next = [...prev, res.situation].slice(-30);
        try { localStorage.setItem("erp_wa_asked", JSON.stringify(next)); } catch {}
        return next;
      });
    } else setIv({ loading: false, err: res?.error || "Could not get a question", q: null, custom: "" });
  };
  const answerQuestion = (answer) => {
    if (!iv.q || !String(answer).trim()) return;
    const situation = iv.q.situation.replace(/[.:\s]+$/, "");
    addRule(`${situation}: ${String(answer).trim()}`);
    nextQuestion();
  };

  const runTest = async () => {
    const msg = tst.msg.trim();
    if (!msg) return;
    if (!localSettings.waGeminiKey) { setTst((t) => ({ ...t, err: "Add the Gemini key in Settings first" })); return; }
    setTst((t) => ({ ...t, loading: true, reply: "", err: "" }));
    const { callWhatsAppFn } = await import("../../stores/adminApi.js");
    const res = await callWhatsAppFn("whatsapp-agent", {
      mode: "test", geminiKey: localSettings.waGeminiKey, trainingData, message: msg,
    });
    setTst((t) => ({ ...t, loading: false, reply: res?.success ? res.reply : "", err: res?.success ? "" : (res?.error || "No reply came back") }));
  };

  const connected = !!(localSettings.waApiKey && localSettings.waOwnerPhone);

  // Four sections, not five. "Message Log" used to sit beside Chats showing
  // the ERP's own outbound alerts — the same messages Chats already lists,
  // under a second name. Two places for one thing is a question the operator
  // has to answer every time they open the panel, so it is gone.
  const menuItems = [
    // Unread, not total: a count that never changes is a count nobody reads.
    { id: "chats",    Icon: MessagesSquare, label: "Chats",       badge: unread || null },
    // Attention, not a count: "!" only while alerts have no template to go out with.
    { id: "templates",Icon: FileText,       label: "Templates",   badge: localSettings.waApiKey && !localSettings.waAlertTemplate ? "!" : null },
    { id: "training", Icon: Sparkles,       label: "AI Training", badge: rules.length || null },
    { id: "settings", Icon: Settings,       label: "Settings",    badge: dirty ? "●" : null },
  ];

  return (
    // has-active drives the one-pane-at-a-time behaviour on a phone: the list
    // and the conversation share the screen instead of fighting for it.
    <div className={`wa-root ${activeChat ? "has-active" : ""}`}>

      {/* ── Module header ──
          This used to be a second navy sidebar standing right beside the ERP's
          own. Two dark rails in a row read as two different apps and ate 208px
          of the width the conversation needed, so the sections became tabs in
          an ERP page header — the same shape History & Reports and Settings
          already use. */}
      <div className="wa-top">
        <div className="wa-top-row">
          {/* Every other page gets this from Topbar. Without it a phone that
              opened WhatsApp had no way back to the rest of the ERP. */}
          {onMobileMenu && (
            <button onClick={onMobileMenu} aria-label="Open navigation"
                    className="nav-menu-btn flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center"
                    style={{ color: "var(--wa-ink-2)", border: "1px solid var(--wa-line)" }}>
              <Menu size={18} aria-hidden="true" />
            </button>
          )}
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
               style={{ background: "var(--wa-live)" }}>
            <WaLogo size={20} />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-[17px] font-extrabold tracking-[-0.02em] leading-none"
                style={{ color: "var(--wa-ink)" }}>WhatsApp</h1>
            <div className="text-[11.5px] mt-1.5 leading-none flex items-center gap-1.5"
                 style={{ color: "var(--wa-ink-2)" }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full"
                    style={{ background: connected ? "var(--wa-live)" : "#d97706" }} />
              {connected ? "+91 70161 00287" : "Setup incomplete"}
            </div>
          </div>
          {dirty && canEdit && (
            <button onClick={handleSave}
                    className="px-4 py-2 rounded-lg text-[12px] font-semibold text-white flex-shrink-0"
                    style={{ background: "var(--wa-accent)" }}>
              Save changes
            </button>
          )}
        </div>

        <div className="wa-tabs">
          {menuItems.map((item) => (
            <button key={item.id} onClick={() => setSection(item.id)}
                    className={`wa-tab ${section === item.id ? "is-on" : ""}`}>
              <item.Icon size={15} className="flex-shrink-0" aria-hidden="true" />
              <span>{item.label}</span>
              {item.badge && <span className="wa-tab-badge">{item.badge}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* ── RIGHT: Content Area ── */}
      {/* wa-pane is what the responsive rules hang off: below 760px the nav
          drops to a bottom bar and this pane takes the whole screen. */}
      <div className="wa-pane flex-col min-w-0 overflow-hidden">
        {/* ═══ CHATS ═══ */}
        {section === "chats" && (
          <div className="flex-1 flex min-h-0">

            {/* ── Conversation list ── */}
            <div className="wa-list">

              <div className="wa-bar">
                <div className="flex-1 min-w-0">
                  <div className="text-[15px] font-bold" style={{ color: "var(--wa-ink)" }}>Chats</div>
                  <div className="text-[11px]" style={{ color: "var(--wa-ink-2)" }}>
                    {chatsLoading ? "Loading…"
                      : unread ? `${unread} unread`
                      : visibleChats.length ? `${visibleChats.length} conversations`
                      : "No conversations"}
                  </div>
                </div>
                <button onClick={() => { setComposeOpen(true); setComposeTo(""); }}
                        className="wa-icon-btn" title="New chat">
                  <MessageSquarePlus size={18} />
                </button>
                <button onClick={() => loadChats()} disabled={chatsLoading} title="Refresh" className="wa-icon-btn">
                  <RefreshCw size={17} className={chatsLoading ? "animate-spin" : ""} />
                </button>
              </div>

              <div className="px-3 py-2 flex-shrink-0" style={{ borderBottom: "1px solid var(--wa-line)" }}>
                <div className="relative">
                  <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ color: "var(--wa-ink-2)" }} />
                  <input value={chatSearch} onChange={(e) => setChatSearch(e.target.value)}
                         placeholder="Search name or number" className="wa-search" />
                </div>
              </div>

              {/* Start a conversation with someone who has not messaged us.
                  The number book comes first — typing digits is the fallback,
                  not the main road. */}
              {composeOpen && (
                <div className="px-3 py-3 flex-shrink-0"
                     style={{ background: "var(--wa-field)", borderBottom: "1px solid var(--wa-line)" }}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[12.5px] font-semibold" style={{ color: "var(--wa-ink)" }}>New chat</div>
                    <button onClick={() => setComposeOpen(false)} className="wa-icon-btn" style={{ width: 26, height: 26 }}>
                      <X size={14} />
                    </button>
                  </div>
                  {directory.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2">
                      {directory.filter((p) => p?.phone).map((p) => {
                        const picked = waPhoneKey(composeTo) === waPhoneKey(p.phone);
                        return (
                          <button key={p.phone} onClick={() => setComposeTo(p.phone)}
                                  className="text-[11.5px] px-2.5 py-1.5 rounded-full"
                                  style={{
                                    border: `1px solid ${picked ? "var(--wa-accent)" : "var(--wa-line)"}`,
                                    background: picked ? "var(--wa-accent)" : "var(--wa-surface)",
                                    color: picked ? "#fff" : "var(--wa-ink)",
                                  }}>
                            {p.name || p.phone}{p.dept ? ` · ${p.dept}` : ""}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <input value={composeTo} autoFocus
                           onChange={(e) => setComposeTo(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter") startChat(); }}
                           placeholder="919876543210"
                           className="wa-field-input" style={{ flex: 1 }} />
                    <button onClick={startChat} disabled={composeTo.replace(/[^0-9]/g, "").length < 10}
                            className="px-3 rounded-lg text-[12.5px] font-semibold text-white flex-shrink-0 disabled:opacity-40"
                            style={{ background: "var(--wa-accent)" }}>Open</button>
                  </div>
                  <div className="wa-field-help">
                    {directory.length === 0 && "Add people in Settings to pick them by name. "}
                    Include country code, no + or spaces.
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto">
                {chatsErr && (
                  <div className="m-3 px-3 py-2.5 rounded-lg text-[11.5px] flex items-start gap-2"
                       style={{ background: "rgba(220,38,38,.07)", border: "1px solid rgba(220,38,38,.28)", color: "#b91c1c" }}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{chatsErr}</span>
                  </div>
                )}

                {!chatsLoading && !chatsErr && visibleChats.length === 0 && (
                  <div className="px-8 py-14 text-center">
                    <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
                         style={{ background: "var(--wa-field)" }}>
                      <MessagesSquare size={28} style={{ color: "var(--wa-ink-2)" }} />
                    </div>
                    <div className="text-[14px] font-bold mb-1" style={{ color: "var(--wa-ink)" }}>
                      {chatSearch ? "No matches" : "No chats yet"}
                    </div>
                    <div className="text-[12px] leading-relaxed mb-4" style={{ color: "var(--wa-ink-2)" }}>
                      {chatSearch
                        ? <>No conversation with this name or number</>
                        : <>When someone messages your WhatsApp number,<br />it appears here automatically</>}
                    </div>
                    {!chatSearch && (
                      <button onClick={() => setComposeOpen(true)}
                              className="text-[12px] font-semibold px-3.5 py-2 rounded-lg inline-flex items-center gap-1.5"
                              style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                        <Plus size={14} /> Start a chat
                      </button>
                    )}
                  </div>
                )}

                {visibleChats.map((c) => {
                  const on   = activeChat?.id === c.id;
                  const who  = whoIs(c.phone, c.name);
                  const isUnread = c.lastDirection === "inbound" && Number(c.lastTs || 0) > Number(seen[c.id] || 0);
                  return (
                    <div key={c.id} role="button" tabIndex={0}
                         onClick={() => openChat(c)}
                         onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openChat(c); } }}
                         className={`wa-row ${on ? "is-on" : ""}`}>
                      <div className="wa-av" style={{ background: waAvatarColor(who.name || c.phone) }}>
                        {who.known || /[a-z]/i.test(who.name) ? (who.name || "?").trim().charAt(0).toUpperCase() : <User size={18} />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <div className="text-[14.5px] truncate"
                               style={{ color: "var(--wa-ink)", fontWeight: isUnread ? 700 : 600 }}>
                            {who.name}
                          </div>
                          <div className="text-[11px] flex-shrink-0"
                               style={{ color: isUnread ? "var(--wa-live)" : "var(--wa-ink-2)", fontWeight: isUnread ? 700 : 400 }}>
                            {waTime(c.lastTs)}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          {c.lastDirection === "outbound" && <CheckCheck size={14} className="flex-shrink-0 wa-tick-read" />}
                          <div className="text-[13px] truncate flex-1"
                               style={{ color: "var(--wa-ink-2)", fontWeight: isUnread ? 600 : 400 }}>
                            {c.lastText || "—"}
                          </div>
                          {isUnread && <span className="wa-unread" />}
                        </div>
                        {/* The number book's answer, shown so a wrong entry is
                            visible rather than silently mislabelling someone. */}
                        {(who.dept || !who.known) && (
                          <div className="text-[10.5px] mt-0.5 truncate" style={{ color: "var(--wa-ink-2)" }}>
                            {who.known ? who.dept : c.phone}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

              </div>
            </div>

            {/* ── Thread ── */}
            {!activeChat ? (
              <div className="wa-thread-pane wa-empty">
                <div className="w-20 h-20 rounded-full mb-5 flex items-center justify-center"
                     style={{ background: "rgba(15,157,88,.12)" }}>
                  <WaLogo size={40} />
                </div>
                <div className="text-[20px] font-light mb-2" style={{ color: "var(--wa-ink)" }}>Shantaz WhatsApp</div>
                <div className="text-[13px] max-w-sm leading-relaxed" style={{ color: "var(--wa-ink-2)" }}>
                  Pick a chat on the left and reply from here.<br />
                  Every conversation stays in the ERP — not on one person's phone.
                </div>
              </div>
            ) : (
              <div className="wa-thread-pane">

                <div className="px-4 py-2.5 flex items-center gap-3 flex-shrink-0"
                     style={{ background: "var(--wa-field)", borderBottom: "1px solid var(--wa-line)" }}>
                  <button onClick={() => { setActiveChat(null); setMessages([]); setMsgsErr(""); }}
                          className="wa-icon-btn" title="Back">
                    <ArrowLeft size={18} />
                  </button>
                  {(() => {
                    const who = whoIs(activeChat.phone, activeChat.name);
                    return (
                      <>
                        <div className="wa-av" style={{ width: 40, height: 40, fontSize: 15, background: waAvatarColor(who.name || activeChat.phone) }}>
                          {who.known || /[a-z]/i.test(who.name) ? (who.name || "?").trim().charAt(0).toUpperCase() : <User size={18} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-[14.5px] font-semibold truncate" style={{ color: "var(--wa-ink)" }}>{who.name}</div>
                          <div className="text-[11.5px] truncate" style={{ color: "var(--wa-ink-2)" }}>
                            {who.dept ? `${who.dept} · ` : ""}{activeChat.phone}
                          </div>
                        </div>
                      </>
                    );
                  })()}
                  {!activeChat.isNew && (
                    <>
                      <button onClick={() => openChat(activeChat)} disabled={msgsLoading} className="wa-icon-btn" title="Refresh">
                        <RefreshCw size={17} className={msgsLoading ? "animate-spin" : ""} />
                      </button>
                    </>
                  )}
                </div>

                <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col wa-thread">
                  {msgsLoading && messages.length === 0 && (
                    <div className="m-auto text-[12.5px]" style={{ color: "var(--wa-ink-2)" }}>Loading messages…</div>
                  )}
                  {!msgsLoading && messages.length === 0 && !msgsErr && (
                    <div className="m-auto text-[12.5px] text-center" style={{ color: "var(--wa-ink-2)" }}>
                      {activeChat.isNew
                        ? <>This is a new chat.<br />Write the first message below.</>
                        : "No messages in this chat yet"}
                    </div>
                  )}

                  {messages.map((m, i) => {
                    const out  = m.direction === "outbound";
                    const prev = messages[i - 1];
                    const day  = waDayLabel(m.ts);
                    const showDay = day && (!prev || waDayLabel(prev.ts) !== day);
                    const atts = m.attachments || [];
                    return (
                      <React.Fragment key={m.id || i}>
                        {showDay && <div className="wa-day">{day}</div>}
                        <div className="flex w-full" style={{ justifyContent: out ? "flex-end" : "flex-start", marginTop: 2, marginBottom: 2 }}>
                          <div className={`wa-bubble ${out ? "is-out" : "is-in"} ${m.status === "sending" ? "wa-sending" : ""}`}>
                            {atts.map((a, ai) => {
                              const key = `${m.id || i}:${ai}`;
                              const got = media[key];
                              const ext = (got?.mimeType || a.mimeType || "").split("/")[1] || "bin";
                              const fname = a.filename || `whatsapp-${a.kind}-${m.id || i}.${ext}`;
                              // Every attachment state says what happened and offers
                              // the next step — load, retry, or save.
                              const placeholder = (Icon, label) => (
                                <button onClick={() => loadMedia(key, a, !!got?.err)} disabled={got?.loading} className="wa-att-ph">
                                  <Icon size={18} />
                                  <span>{got?.loading ? "Loading…" : got?.err ? `${got.err} — tap to retry` : label}</span>
                                </button>
                              );
                              return (
                                <div key={ai} className="wa-att">
                                  {a.kind === "image" && (got?.url
                                    ? <img src={got.url} alt={a.caption || "Photo"} className="wa-att-img"
                                           onClick={() => window.open(got.url, "_blank")} />
                                    : placeholder(ImageIcon, "Load photo"))}
                                  {(a.kind === "audio") && (got?.url
                                    ? <audio controls src={got.url} className="w-full" style={{ height: 36 }} />
                                    : placeholder(Mic, "Play voice note"))}
                                  {a.kind !== "image" && a.kind !== "audio" && !got?.url && placeholder(Paperclip, a.filename || `Load ${a.kind}`)}
                                  {got?.url && (
                                    <a href={got.url} download={fname} className="wa-att-dl">
                                      <FileDown size={14} /> {a.kind === "image" || a.kind === "audio" ? "Download" : (a.filename || "Download file")}
                                    </a>
                                  )}
                                  {a.caption && <div className="mt-1">{a.caption}</div>}
                                </div>
                              );
                            })}
                            {(m.text || atts.length === 0) && (m.text || "—")}
                            <span className="wa-meta">
                              {waClock(m.ts)}
                              {out && (
                                m.status === "failed"  ? <AlertCircle size={13} className="wa-tick-fail" />
                              : m.status === "sending" ? <Clock size={12} />
                              : m.status === "read"    ? <CheckCheck size={14} className="wa-tick-read" />
                              :                          <CheckCheck size={14} />
                              )}
                            </span>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}
                  <div ref={threadEndRef} />
                </div>

                {msgsErr && (
                  <div className="mx-4 mb-2 px-3 py-2 rounded-lg text-[11.5px] flex items-start gap-2 flex-shrink-0"
                       style={{ background: "rgba(220,38,38,.08)", border: "1px solid rgba(220,38,38,.28)", color: "#b91c1c" }}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>{msgsErr}</span>
                  </div>
                )}

                {/* WhatsApp's own rule, said out loud. Without this the send
                    just fails and the operator has no way to know why. */}
                {!sessionOpen && (
                  <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[11.5px] flex items-start gap-2 flex-shrink-0"
                       style={{ background: "rgba(217,119,6,.08)", border: "1px solid rgba(217,119,6,.3)", color: "#92400e" }}>
                    <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                    <span>
                      No message from this person in the last 24 hours. WhatsApp only allows an
                      approved template now — a plain message will be rejected until they
                      message you again.
                    </span>
                  </div>
                )}

                {/* No emoji or clip button here. Both were decoration — they
                    were disabled, did nothing, and every disabled button is a
                    question the operator asks once and then stops trusting. */}
                <div className="px-3 py-2.5 flex items-center gap-2 flex-shrink-0 wa-composer">
                  <input value={reply} onChange={(e) => setReply(e.target.value)}
                         onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                         placeholder="Type a message" className="wa-input" />
                  <button onClick={sendReply} disabled={!reply.trim() || sendingReply} className="wa-send" title="Send">
                    {sendingReply ? <Clock size={16} /> : <Send size={16} />}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ TEMPLATES ═══ */}
        {section === "templates" && (
          <div className="wa-page">
            <div className="wa-wrap">

              {/* What the alerts actually go out as — the one fact this screen
                  exists to settle. Before, an approved template sat here and
                  changed nothing: alerts were still sent as plain text. */}
              {(() => {
                const inUse = templates.find((t) => t.name === localSettings.waAlertTemplate);
                const inUseOk = inUse && (inUse.status || "").toUpperCase() === "APPROVED";
                const tone = !localSettings.waAlertTemplate ? "#d97706" : inUse && !inUseOk ? "var(--wa-accent)" : "var(--wa-live)";
                return (
                  <div className="wa-status">
                    <span className="wa-dot" style={{ background: tone }} />
                    <div className="flex-1 min-w-0">
                      <div className="text-[14px] font-semibold" style={{ color: "var(--wa-ink)" }}>
                        {!localSettings.waAlertTemplate ? "Alerts are going out as plain messages"
                          : inUse && !inUseOk ? `"${localSettings.waAlertTemplate}" is not approved yet`
                          : `Alerts are going out with "${localSettings.waAlertTemplate}"`}
                      </div>
                      <div className="text-[12px] mt-0.5" style={{ color: "var(--wa-ink-2)" }}>
                        {!localSettings.waAlertTemplate
                          ? "A plain message only reaches people who messaged you in the last 24 hours. Choose an approved template below."
                          : inUse && !inUseOk ? "Until it is approved, alerts go out as plain messages."
                          : "A template reaches everyone. If it ever fails, the ERP sends a plain message instead."}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="flex flex-wrap items-center gap-2 mb-4">
                {canEdit && (
                <button onClick={() => openTplForm(null)}
                        className="px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center gap-1.5"
                        style={{ background: "var(--wa-accent)" }}>
                  <Plus size={15} /> New template
                </button>
                )}
                {canEdit && !templates.some((t) => t.name === ERP_ALERT_TEMPLATE.name) && (
                  <button onClick={() => { setShowNewTpl(true); setTplForm(null); setTplErr(""); setTplMsg(""); }}
                          className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold"
                          style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)", background: "var(--wa-surface)" }}>
                    Ready-made alert template
                  </button>
                )}
                <button onClick={loadTemplates} disabled={tplLoading} title="Refresh"
                        className="wa-icon-btn ml-auto" style={{ border: "1px solid var(--wa-line)", background: "var(--wa-surface)" }}>
                  <RefreshCw size={16} className={tplLoading ? "animate-spin" : ""} />
                </button>
              </div>

              {tplErr && (
                <div className="mb-4 px-3.5 py-2.5 rounded-lg text-[12px] flex items-start gap-2"
                     style={{ background: "rgba(220,38,38,.07)", border: "1px solid rgba(220,38,38,.28)", color: "#b91c1c" }}>
                  <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{tplErr}</span>
                </div>
              )}
              {tplMsg && (
                <div className="mb-4 px-3.5 py-2.5 rounded-lg text-[12px] flex items-start gap-2"
                     style={{ background: "rgba(15,157,88,.07)", border: "1px solid rgba(15,157,88,.28)", color: "#0b6b3c" }}>
                  <Check size={14} className="flex-shrink-0 mt-0.5" /><span>{tplMsg}</span>
                </div>
              )}

              {/* The ready-made alert template. One template with five slots
                  covers issue, transfer and deadline, so Meta approves once. */}
              {showNewTpl && (
                <div className="wa-card">
                  <div className="wa-card-head">
                    <div className="wa-card-title">Ready-made alert template</div>
                    <div className="wa-card-note">
                      One template carries all three alerts — issue, transfer and deadline. The ERP fills in the details.
                    </div>
                  </div>
                  <div className="wa-card-body">
                    <div className="wa-tpl-preview">
                      {tplFill(ERP_ALERT_TEMPLATE.components[0].text, ERP_ALERT_TEMPLATE.components[0].example.body_text[0])}
                    </div>
                    <div className="wa-field-help mb-3">
                      Name <b>{ERP_ALERT_TEMPLATE.name}</b> · Utility · English
                    </div>
                    <div className="flex gap-2">
                      <button onClick={createAlertTemplate} disabled={tplCreating}
                              className="px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-40"
                              style={{ background: "var(--wa-accent)" }}>
                        {tplCreating ? "Sending…" : "Submit to Meta for approval"}
                      </button>
                      <button onClick={() => setShowNewTpl(false)} disabled={tplCreating}
                              className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold"
                              style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Cancel</button>
                    </div>
                  </div>
                </div>
              )}

              {/* Create / edit. Meta's rules are checked here, before the round
                  trip, and said in words — a rejection 20 minutes later teaches
                  nobody anything. */}
              {tplForm && (() => {
                const slots = tplSlots(tplForm.body);
                const setF = (patch) => setTplForm((f) => ({ ...f, ...patch }));
                return (
                  <div className="wa-card">
                    <div className="wa-card-head">
                      <div className="wa-card-title">{tplForm.mode === "edit" ? `Edit "${tplForm.name}"` : "New template"}</div>
                      <div className="wa-card-note">
                        {tplForm.mode === "edit"
                          ? "Only the message can be changed. Meta reviews the template again after an edit."
                          : "Use {{1}}, {{2}} for the parts that change — the ERP fills them in when sending."}
                      </div>
                    </div>
                    <div className="wa-card-body space-y-4">
                      {tplForm.mode === "create" && (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="md:col-span-1">
                            <div className="wa-field-label">Name</div>
                            <input value={tplForm.name} placeholder="daily_stock_update"
                                   onChange={(e) => setF({ name: e.target.value.toLowerCase().replace(/\s+/g, "_") })}
                                   className="wa-field-input" />
                          </div>
                          <div>
                            <div className="wa-field-label">Category</div>
                            <select value={tplForm.category} onChange={(e) => setF({ category: e.target.value })} className="wa-field-input">
                              <option value="UTILITY">Utility</option>
                              <option value="MARKETING">Marketing</option>
                            </select>
                          </div>
                          <div>
                            <div className="wa-field-label">Language</div>
                            <select value={tplForm.language} onChange={(e) => setF({ language: e.target.value })} className="wa-field-input">
                              <option value="en">English</option>
                              <option value="hi">Hindi</option>
                            </select>
                          </div>
                        </div>
                      )}
                      <div>
                        <div className="wa-field-label">Message</div>
                        <textarea value={tplForm.body} rows={6}
                                  onChange={(e) => setF({ body: e.target.value })}
                                  placeholder={"Shantaz Technofoods - Stock Update\n\nStock of {{1}} is {{2}} today. Please take note."}
                                  className="wa-field-input" style={{ resize: "vertical", lineHeight: 1.5 }} />
                        <button onClick={() => setF({ body: `${tplForm.body}{{${slots.length + 1}}}` })}
                                className="mt-1.5 text-[11.5px] font-semibold px-2.5 py-1 rounded-md"
                                style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                          + Add placeholder {`{{${slots.length + 1}}}`}
                        </button>
                      </div>
                      {slots.length > 0 && (
                        <div>
                          <div className="wa-field-label">Sample value for each placeholder</div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {slots.map((n) => (
                              <div key={n} className="flex items-center gap-2">
                                <span className="text-[12px] font-semibold w-10 flex-shrink-0" style={{ color: "var(--wa-ink-2)" }}>{`{{${n}}}`}</span>
                                <input value={tplForm.examples[n - 1] || ""}
                                       onChange={(e) => setTplForm((f) => { const ex = [...f.examples]; ex[n - 1] = e.target.value; return { ...f, examples: ex }; })}
                                       className="wa-field-input" />
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {tplForm.body.trim() && (
                        <div>
                          <div className="wa-field-label">Preview</div>
                          <div className="wa-tpl-preview">{tplFill(tplForm.body, tplForm.examples)}</div>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={saveTplForm} disabled={!canEdit || !!tplFormProblem || tplCreating}
                                className="px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white disabled:opacity-40"
                                style={{ background: "var(--wa-accent)" }}>
                          {tplCreating ? "Sending…" : tplForm.mode === "edit" ? "Submit changes to Meta" : "Submit to Meta for approval"}
                        </button>
                        <button onClick={() => setTplForm(null)} disabled={tplCreating}
                                className="px-3.5 py-2 rounded-lg text-[12.5px] font-semibold"
                                style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Cancel</button>
                        {tplFormProblem && (
                          <span className="text-[12px]" style={{ color: "#92400e" }}>{tplFormProblem}</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {!tplLoading && templates.length === 0 && !tplErr && !showNewTpl && !tplForm && (
                <div className="wa-card">
                  <div className="wa-card-body text-center py-10">
                    <FileText size={30} className="mx-auto mb-3" style={{ color: "var(--wa-ink-2)" }} />
                    <div className="text-[14px] font-semibold mb-1" style={{ color: "var(--wa-ink)" }}>No templates yet</div>
                    <div className="text-[12.5px]" style={{ color: "var(--wa-ink-2)" }}>
                      Submit the "Ready-made alert template" so alerts reach everyone.
                    </div>
                  </div>
                </div>
              )}

              {templates.map((t) => {
                const st = (t.status || "").toUpperCase();
                const approved = st === "APPROVED";
                const rejected = st === "REJECTED";
                const chip = approved ? { fg: "#0b6b3c", bg: "rgba(15,157,88,.1)",  txt: "Approved" }
                           : rejected ? { fg: "#b91c1c", bg: "rgba(220,38,38,.09)", txt: "Rejected" }
                           : st === "PAUSED" || st === "DISABLED" ? { fg: "#b91c1c", bg: "rgba(220,38,38,.09)", txt: st === "PAUSED" ? "Paused" : "Disabled" }
                           :            { fg: "#92400e", bg: "rgba(217,119,6,.1)",  txt: "In review" };
                const isAlert = localSettings.waAlertTemplate === t.name;
                const busy = (a) => tplBusy === `${a}:${t.name}`;
                return (
                  <div key={t.id || t.name} className="wa-card" style={isAlert ? { borderColor: "var(--wa-live)" } : undefined}>
                    <div className="wa-card-head flex items-start gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="wa-card-title truncate">{t.name}</div>
                        <div className="wa-card-note">
                          {t.category === "MARKETING" ? "Marketing" : t.category === "UTILITY" ? "Utility" : t.category}
                          {" · "}{t.language === "hi" ? "Hindi" : t.language === "en" ? "English" : t.language}
                          {isAlert && <span style={{ color: "var(--wa-live)", fontWeight: 600 }}> · Used for alerts</span>}
                        </div>
                      </div>
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full flex-shrink-0"
                            style={{ color: chip.fg, background: chip.bg }}>{chip.txt}</span>
                    </div>
                    <div className="wa-card-body">
                      {rejected && (
                        <div className="mb-3 px-3 py-2 rounded-lg text-[12px]"
                             style={{ background: "rgba(220,38,38,.06)", color: "#b91c1c" }}>
                          Meta's reason: <b>{t.rejectedReason || "not given"}</b>.
                          {" "}Edit the message and submit again.
                        </div>
                      )}
                      {t.text && <div className="wa-tpl-preview">{tplFill(t.text, t.example)}</div>}

                      <div className="flex flex-wrap items-center gap-2 mt-3">
                        {canEdit && approved && !isAlert && tplFitsAlerts(t) && (
                          <button onClick={() => chooseAlertTemplate(t)}
                                  className="px-3.5 py-2 rounded-lg text-[12px] font-semibold text-white"
                                  style={{ background: "var(--wa-live)" }}>
                            Use for alerts
                          </button>
                        )}
                        {canEdit && isAlert && (
                          <button onClick={stopTemplateForAlerts}
                                  className="px-3.5 py-2 rounded-lg text-[12px] font-semibold"
                                  style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                            Stop using for alerts
                          </button>
                        )}
                        {approved && (
                          <button onClick={() => testTemplate(t)} disabled={!!tplBusy}
                                  className="px-3.5 py-2 rounded-lg text-[12px] font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
                                  style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                            <Send size={13} /> {busy("test") ? "Sending…" : "Send me a test"}
                          </button>
                        )}
                        {canEdit && st !== "PENDING" && (
                          <button onClick={() => openTplForm(t)} disabled={!!tplBusy}
                                  className="px-3.5 py-2 rounded-lg text-[12px] font-semibold disabled:opacity-40"
                                  style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                            Edit
                          </button>
                        )}
                        <span className="flex-1" />
                        {!canEdit ? null : tplConfirm === t.name ? (
                          <span className="flex items-center gap-2 text-[12px]" style={{ color: "#b91c1c" }}>
                            Delete? This name cannot be reused for 30 days.
                            <button onClick={() => deleteTemplate(t)}
                                    className="px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: "#b91c1c" }}>
                              {busy("delete") ? "Deleting…" : "Delete"}
                            </button>
                            <button onClick={() => setTplConfirm("")}
                                    className="px-3 py-1.5 rounded-lg font-semibold"
                                    style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Cancel</button>
                          </span>
                        ) : (
                          <button onClick={() => setTplConfirm(t.name)} disabled={!!tplBusy}
                                  className="wa-icon-btn" title="Delete">
                            <Trash2 size={15} />
                          </button>
                        )}
                      </div>
                      {approved && !tplFitsAlerts(t) && (
                        <div className="wa-field-help">
                          Alerts need exactly five placeholders, {"{{1}}"} to {"{{5}}"} — this template is for other messages.
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ═══ AI TRAINING ═══ */}
        {section === "training" && (
          <div className="wa-page">
            <div className="wa-wrap">

              {!localSettings.waGeminiKey && (
                <div className="wa-status">
                  <span className="wa-dot" style={{ background: "#d97706" }} />
                  <div className="flex-1 min-w-0 text-[13px]" style={{ color: "var(--wa-ink)" }}>
                    The agent needs a Gemini key in Settings.
                  </div>
                  <button onClick={() => setSection("settings")}
                          className="text-[12px] font-semibold px-3 py-2 rounded-lg flex-shrink-0"
                          style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Open Settings</button>
                </div>
              )}

              {/* ── Interview. The agent asks about one situation it cannot
                  handle yet and offers answers to pick. Choosing is faster
                  than writing, and each pick becomes one rule below. ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Guided training</div>
                  <div className="wa-card-note">
                    The agent asks about one situation at a time. Pick an answer and it becomes a rule.
                  </div>
                </div>
                <div className="wa-card-body">
                  {!iv.q && !iv.loading && (
                    <button onClick={nextQuestion} disabled={!localSettings.waGeminiKey}
                            className="px-4 py-2 rounded-lg text-[12.5px] font-semibold text-white inline-flex items-center gap-1.5 disabled:opacity-40"
                            style={{ background: "var(--wa-accent)" }}>
                      <Sparkles size={15} /> {ivAsked.length ? "Next question" : "Start questions"}
                    </button>
                  )}
                  {iv.loading && (
                    <div className="text-[12.5px] flex items-center gap-2" style={{ color: "var(--wa-ink-2)" }}>
                      <RefreshCw size={14} className="animate-spin" /> Preparing a question…
                    </div>
                  )}
                  {iv.err && (
                    <div className="mt-2 text-[12px] flex items-start gap-2" style={{ color: "#b91c1c" }}>
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{iv.err}</span>
                    </div>
                  )}
                  {iv.q && (
                    <div>
                      <div className="text-[11.5px] font-semibold mb-1" style={{ color: "var(--wa-ink-2)" }}>{iv.q.situation}</div>
                      <div className="text-[15px] font-semibold mb-3" style={{ color: "var(--wa-ink)", lineHeight: 1.45 }}>{iv.q.question}</div>
                      <div className="space-y-2">
                        {iv.q.options.map((o, i) => (
                          <button key={i} onClick={() => answerQuestion(o)} className="wa-choice">{o}</button>
                        ))}
                      </div>
                      <div className="flex gap-2 mt-3">
                        <input value={iv.custom} onChange={(e) => setIv((v) => ({ ...v, custom: e.target.value }))}
                               onKeyDown={(e) => { if (e.key === "Enter") answerQuestion(iv.custom); }}
                               placeholder="Or write your own answer" className="wa-field-input" style={{ flex: 1 }} />
                        <button onClick={() => answerQuestion(iv.custom)} disabled={!iv.custom.trim()}
                                className="px-3.5 rounded-lg text-[12.5px] font-semibold text-white flex-shrink-0 disabled:opacity-40"
                                style={{ background: "var(--wa-accent)" }}>Save</button>
                      </div>
                      <button onClick={nextQuestion} className="mt-3 text-[12px] font-semibold" style={{ color: "var(--wa-ink-2)" }}>
                        Skip this question
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Test. Same prompt and rules as the live auto-reply, but
                  nothing is sent — the safe way to check a rule landed. ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Test the agent — nothing is sent</div>
                  <div className="wa-card-note">Type a message as an employee would. You will see the exact reply the agent would send on WhatsApp.</div>
                </div>
                <div className="wa-card-body">
                  <div className="flex gap-2">
                    <input value={tst.msg} onChange={(e) => setTst((t) => ({ ...t, msg: e.target.value }))}
                           onKeyDown={(e) => { if (e.key === "Enter") runTest(); }}
                           placeholder="e.g. KM10 pump is leaking" className="wa-field-input" style={{ flex: 1 }} />
                    <button onClick={runTest} disabled={!tst.msg.trim() || tst.loading || !localSettings.waGeminiKey}
                            className="px-3.5 rounded-lg text-[12.5px] font-semibold text-white flex-shrink-0 disabled:opacity-40"
                            style={{ background: "var(--wa-accent)" }}>
                      {tst.loading ? "Thinking…" : "Get reply"}
                    </button>
                  </div>
                  {tst.err && (
                    <div className="mt-3 text-[12px] flex items-start gap-2" style={{ color: "#b91c1c" }}>
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" /><span>{tst.err}</span>
                    </div>
                  )}
                  {tst.reply && (
                    <div className="mt-3 wa-thread rounded-lg p-3 flex flex-col gap-1.5">
                      <div className="flex"><div className="wa-bubble is-in">{tst.msg}</div></div>
                      <div className="flex justify-end"><div className="wa-bubble is-out">{tst.reply}</div></div>
                    </div>
                  )}
                </div>
              </div>

              {/* ── Rules. Each one editable and removable on its own. ── */}
              <div className="wa-card">
                <div className="wa-card-head flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="wa-card-title">Agent rules {rules.length > 0 && <span style={{ color: "var(--wa-ink-2)", fontWeight: 500 }}>· {rules.length}</span>}</div>
                    <div className="wa-card-note">This is everything the agent knows. Edit or remove anything that is wrong.</div>
                  </div>
                  {rules.length > 0 && !clearAsk && (
                    <button onClick={() => setClearAsk(true)} className="text-[12px] font-semibold flex-shrink-0" style={{ color: "var(--wa-ink-2)" }}>
                      Clear all
                    </button>
                  )}
                </div>
                <div className="wa-card-body">
                  {clearAsk && (
                    <div className="mb-3 px-3 py-2.5 rounded-lg text-[12px] flex flex-wrap items-center gap-2"
                         style={{ background: "rgba(220,38,38,.06)", color: "#b91c1c" }}>
                      <span className="flex-1">All {rules.length} rules will be removed and the agent will know nothing. Continue?</span>
                      <button onClick={() => { writeRules([]); setClearAsk(false); }}
                              className="px-3 py-1.5 rounded-lg font-semibold text-white" style={{ background: "#b91c1c" }}>Clear all</button>
                      <button onClick={() => setClearAsk(false)}
                              className="px-3 py-1.5 rounded-lg font-semibold"
                              style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Cancel</button>
                    </div>
                  )}

                  {rules.length === 0 && (
                    <div className="text-[12.5px] py-2" style={{ color: "var(--wa-ink-2)" }}>
                      No rules yet. Use "Start questions" above, or add one below.
                    </div>
                  )}

                  {rules.map((r, i) => (
                    <div key={i} className="wa-rule">
                      {ruleEdit?.i === i ? (
                        <div className="flex-1 flex gap-2">
                          <textarea value={ruleEdit.text} rows={2} autoFocus
                                    onChange={(e) => setRuleEdit({ i, text: e.target.value })}
                                    className="wa-field-input" style={{ flex: 1, resize: "vertical" }} />
                          <div className="flex flex-col gap-1.5">
                            <button onClick={() => { writeRules(rules.map((x, j) => (j === i ? ruleEdit.text : x))); setRuleEdit(null); }}
                                    disabled={!ruleEdit.text.trim()}
                                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
                                    style={{ background: "var(--wa-accent)" }}>Save</button>
                            <button onClick={() => setRuleEdit(null)}
                                    className="px-3 py-1.5 rounded-lg text-[12px] font-semibold"
                                    style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Cancel</button>
                          </div>
                        </div>
                      ) : (
                        <>
                          <div className="flex-1 min-w-0 text-[13px]" style={{ color: "var(--wa-ink)", lineHeight: 1.5 }}>{r}</div>
                          <button onClick={() => setRuleEdit({ i, text: r })} className="wa-icon-btn" title="Edit">
                            <FileText size={15} />
                          </button>
                          <button onClick={() => writeRules(rules.filter((_, j) => j !== i))} className="wa-icon-btn" title="Remove">
                            <Trash2 size={15} />
                          </button>
                        </>
                      )}
                    </div>
                  ))}

                  <div className="flex gap-2 mt-3">
                    <input value={newRule} onChange={(e) => setNewRule(e.target.value)}
                           onKeyDown={(e) => { if (e.key === "Enter" && newRule.trim()) { addRule(newRule); setNewRule(""); } }}
                           placeholder="e.g. If someone asks for leave, tell them to send the HR form" className="wa-field-input" style={{ flex: 1 }} />
                    <button onClick={() => { addRule(newRule); setNewRule(""); }} disabled={!newRule.trim()}
                            className="px-3.5 rounded-lg text-[12.5px] font-semibold flex-shrink-0 inline-flex items-center gap-1 disabled:opacity-40"
                            style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                      <Plus size={14} /> Add
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ SETTINGS ═══ */}
        {section === "settings" && (
          <div className="wa-page">
            <div className="wa-wrap">

              {/* Status first. The old badge only checked that the boxes were
                  non-empty, so a wrong key still read "Connected". This reports
                  what is actually true: which number is in use, whether the
                  last real call to Chakra worked, and what is still missing. */}
              <div className="wa-status">
                <span className="wa-dot" style={{ background: setupMissing.length ? "#d97706" : connCheck === "bad" ? "var(--wa-accent)" : "var(--wa-live)" }} />
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] font-semibold" style={{ color: "var(--wa-ink)" }}>
                    {setupMissing.length
                      ? "Setup incomplete"
                      : connCheck === "bad" ? "Cannot reach Chakra HQ"
                      : connCheck === "ok"  ? "Connected"
                      : "Not checked yet"}
                  </div>
                  <div className="text-[12px] mt-0.5" style={{ color: "var(--wa-ink-2)" }}>
                    {setupMissing.length
                      ? `Missing: ${setupMissing.join(", ")}`
                      : <>Business number <b>+91 70161 00287</b>{chats.length ? ` · ${chats.length} conversations` : ""}</>}
                  </div>
                </div>
                <button onClick={checkConnection} disabled={connCheck === "checking" || !localSettings.waApiKey}
                        className="text-[12px] font-semibold px-3 py-2 rounded-lg flex-shrink-0 disabled:opacity-40"
                        style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                  {connCheck === "checking" ? "Checking…" : "Check connection"}
                </button>
              </div>

              {/* ── Connection ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Chakra HQ connection</div>
                  <div className="wa-card-note">
                    These four values come from Chakra HQ. Set them once.
                  </div>
                </div>
                <div className="wa-card-body grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { key: "waApiKey",   label: "API key",         secret: true,  help: "Chakra HQ → API Integration → New ApiKey. Use the Admin role, otherwise chats will not load." },
                    { key: "waPluginId", label: "Plugin ID",       secret: false, help: "Chakra HQ → Whatsapp Accounts → View Plugin. The long number in the address bar." },
                    { key: "waPhoneId",  label: "Phone number ID", secret: false, help: "Chakra HQ → Whatsapp Accounts, the ID shown under your number." },
                    { key: "waWabaId",   label: "WABA ID",         secret: false, help: "The business account ID on the same page. Needed for templates." },
                  ].map(({ key, label, secret, help }) => {
                    const val = localSettings[key] || "";
                    return (
                      <div key={key}>
                        <div className="wa-field-label">{label}</div>
                        {/* A password box full of dots looks identical whether a
                            key is saved or not. This says which it is, and only
                            opens an input when you actually want to change it. */}
                        {secret && val && !revealKey[key] ? (
                          <div className="flex items-center gap-2">
                            <div className="wa-field-input flex items-center gap-2" style={{ color: "var(--wa-ink-2)" }}>
                              <Check size={14} style={{ color: "var(--wa-live)" }} />
                              Saved · …{val.slice(-6)}
                            </div>
                            <button onClick={() => setRevealKey((p) => ({ ...p, [key]: true }))}
                                    className="text-[12px] font-semibold px-3 py-2 rounded-lg flex-shrink-0"
                                    style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Change</button>
                          </div>
                        ) : (
                          <input type={secret ? "password" : "text"} value={val}
                                 onChange={(e) => upd(key, e.target.value.trim())}
                                 placeholder={secret ? "Paste here" : ""}
                                 className="wa-field-input" />
                        )}
                        <div className="wa-field-help">{help}</div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* ── Who gets alerts ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Alert kisko jaaye</div>
                  <div className="wa-card-note">These numbers get a WhatsApp message when something happens on a machine.</div>
                </div>
                <div className="wa-card-body space-y-4">
                  <div>
                    <div className="wa-field-label">Your number</div>
                    <input value={localSettings.waOwnerPhone}
                           onChange={(e) => upd("waOwnerPhone", e.target.value.replace(/[^0-9]/g, ""))}
                           placeholder="919876543210" className="wa-field-input" />
                    <div className="wa-field-help">Include country code, no + or spaces. Every alert comes here.</div>
                  </div>
                  {/* A comma-separated string of digits used to live here. It
                      was enough to SEND an alert and useless for everything
                      else: the inbox could not name whose message it was, and
                      nobody could tell whether a number in the list was still
                      the right person. Same list, with the two facts that make
                      it readable — who, and which department. */}
                  <div>
                    <div className="wa-field-label">Other people</div>
                    <div className="space-y-2 mt-1">
                      {directory.map((p, i) => (
                        <div key={i} className="flex gap-2 items-center wa-dir-row">
                          <input value={p.name || ""} placeholder="Name"
                                 onChange={(e) => setDirRow(i, { name: e.target.value })}
                                 className="wa-field-input" style={{ flex: "1 1 32%" }} />
                          <input value={p.phone || ""} placeholder="919876543210" inputMode="numeric"
                                 onChange={(e) => setDirRow(i, { phone: e.target.value.replace(/[^0-9]/g, "") })}
                                 className="wa-field-input" style={{ flex: "1 1 34%" }} />
                          <input value={p.dept || ""} placeholder="Department"
                                 onChange={(e) => setDirRow(i, { dept: e.target.value })}
                                 className="wa-field-input" style={{ flex: "1 1 28%" }} />
                          <button onClick={() => removeDirRow(i)} disabled={!canEdit} className="wa-icon-btn" title="Remove">
                            <Trash2 size={15} />
                          </button>
                        </div>
                      ))}
                    </div>
                    <button onClick={addDirRow}
                            className="mt-2 text-[12px] font-semibold px-3 py-2 rounded-lg inline-flex items-center gap-1.5"
                            style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>
                      <Plus size={14} /> Add person
                    </button>
                    <div className="wa-field-help">
                      They get the same alerts you do, and their messages show by name in
                      Chats instead of by number.
                      {deptNumbers.length > 0 && ` ${deptNumbers.length} number(s) set.`}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Alerts. Daily Summary used to sit here with a toggle that
                  switched nothing on — no daily-summary code exists — so it is
                  gone rather than quietly lying. ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Alerts to send</div>
                  <div className="wa-card-note">Sent on WhatsApp as soon as these happen on the production floor.</div>
                </div>
                <div className="wa-card-body pt-1">
                  {!localSettings.waAlertTemplate && (
                    <div className="mt-2 px-3 py-2.5 rounded-lg text-[12px] flex items-start gap-2"
                         style={{ background: "rgba(217,119,6,.08)", border: "1px solid rgba(217,119,6,.3)", color: "#92400e" }}>
                      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                      <span>
                        No approved template is selected, so alerts only reach people who messaged you
                        in the last 24 hours.{" "}
                        <button onClick={() => setSection("templates")} className="font-semibold underline">Choose a template</button>
                      </span>
                    </div>
                  )}
                  {[
                    { key: "waNotifyIssue",    dot: "#dc2626", label: "Machine issue",       desc: "Someone raises a fault" },
                    { key: "waNotifyTransfer", dot: "#0f9d58", label: "Transfer complete",   desc: "A machine moved to the next department" },
                    { key: "waNotifyDeadline", dot: "#d97706", label: "Deadline exceeded",   desc: "A handover took longer than allowed" },
                  ].map(({ key, dot, label, desc }) => (
                    <div key={key} className="wa-switch-row">
                      <span className="wa-dot" style={{ background: dot }} />
                      <div className="flex-1 min-w-0">
                        <div className="text-[13.5px] font-semibold" style={{ color: "var(--wa-ink)" }}>{label}</div>
                        <div className="text-[12px]" style={{ color: "var(--wa-ink-2)" }}>{desc}</div>
                      </div>
                      <button onClick={() => upd(key, !localSettings[key])} aria-pressed={!!localSettings[key]}
                              className="wa-toggle"
                              style={{ background: localSettings[key] ? "var(--wa-live)" : "#cbd5e1" }}>
                        <i style={{ transform: localSettings[key] ? "translateX(21px)" : "translateX(3px)" }} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Auto-reply. Moved out of the alert list, where it had
                  nothing to do with machine events, and put beside the key
                  that actually powers it. ── */}
              <div className="wa-card">
                <div className="wa-card-head">
                  <div className="wa-card-title">Auto-reply</div>
                  <div className="wa-card-note">
                    Replies to messages on your number automatically, 24×7, using what
                    you teach it in AI Training.
                  </div>
                </div>
                <div className="wa-card-body">
                  <div className="wa-switch-row" style={{ paddingTop: 0 }}>
                    <div className="flex-1 min-w-0">
                      <div className="text-[13.5px] font-semibold" style={{ color: "var(--wa-ink)" }}>Auto-reply on</div>
                      <div className="text-[12px]" style={{ color: "var(--wa-ink-2)" }}>
                        {localSettings.waGeminiKey ? "Gemini key is set" : "Add the Gemini key below first"}
                      </div>
                    </div>
                    <button onClick={() => upd("waAutoReply", !localSettings.waAutoReply)}
                            disabled={!localSettings.waGeminiKey}
                            aria-pressed={!!localSettings.waAutoReply}
                            className="wa-toggle disabled:opacity-40"
                            style={{ background: localSettings.waAutoReply ? "var(--wa-live)" : "#cbd5e1" }}>
                      <i style={{ transform: localSettings.waAutoReply ? "translateX(21px)" : "translateX(3px)" }} />
                    </button>
                  </div>

                  <div className="pt-3">
                    <div className="wa-field-label">Gemini API key</div>
                    {localSettings.waGeminiKey && !revealKey.waGeminiKey ? (
                      <div className="flex items-center gap-2">
                        <div className="wa-field-input flex items-center gap-2" style={{ color: "var(--wa-ink-2)" }}>
                          <Check size={14} style={{ color: "var(--wa-live)" }} />
                          Saved · …{localSettings.waGeminiKey.slice(-6)}
                        </div>
                        <button onClick={() => setRevealKey((p) => ({ ...p, waGeminiKey: true }))}
                                className="text-[12px] font-semibold px-3 py-2 rounded-lg flex-shrink-0"
                                style={{ border: "1px solid var(--wa-line)", color: "var(--wa-ink)" }}>Change</button>
                      </div>
                    ) : (
                      <input type="password" value={localSettings.waGeminiKey}
                             onChange={(e) => upd("waGeminiKey", e.target.value.trim())}
                             placeholder="Paste here" className="wa-field-input" />
                    )}
                    <div className="wa-field-help">aistudio.google.com → Create API key</div>
                  </div>
                </div>
              </div>

              {/* Saving used to just make the button vanish, which left you
                  guessing — twice today it looked saved when it was not. */}
              <div className="flex items-center gap-3">
                <button onClick={handleSave} disabled={!dirty || !canEdit}
                        className="px-5 py-2.5 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40"
                        style={{ background: "var(--wa-accent)" }}>
                  Save changes
                </button>
                {saveNote && (
                  <span className="text-[12.5px] flex items-center gap-1.5" style={{ color: "var(--wa-live)" }}>
                    <Check size={15} /> {saveNote}
                  </span>
                )}
                {dirty && !saveNote && (
                  <span className="text-[12.5px]" style={{ color: "var(--wa-ink-2)" }}>Unsaved changes</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
