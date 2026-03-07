/**
 * App.tsx — ChattBox main component
 *
 * Architecture:
 *   1. Aptos wallet is used ONLY for authentication (connect + get address).
 *      No `signMessage` call — so MultiKey / Keyless accounts work fine.
 *   2. A deterministic EVM keypair is generated & persisted in localStorage,
 *      keyed by the Aptos address. This keypair is the XMTP identity.
 *   3. XMTP client follows the official browser-sdk v6 docs exactly.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Send,
  Plus,
  MessageSquare,
  LogOut,
  Loader2,
  Search,
  ChevronRight,
  Copy,
  Check,
} from "lucide-react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useXMTP } from "./hooks/useXMTP";
import { getOrCreateEvmWallet, createXmtpSigner } from "./lib/xmtp-wallet";
import type { Dm } from "@xmtp/browser-sdk";

/* ── types ───────────────────────────────────────────────────────────────── */

type AppStatus =
  | "disconnected"
  | "connecting"
  | "initializing_xmtp"
  | "ready"
  | "error";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function errMsg(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function shorten(addr: string, pre = 6, suf = 4): string {
  if (addr.length <= pre + suf + 3) return addr;
  return `${addr.slice(0, pre)}...${addr.slice(-suf)}`;
}

/* ── component ───────────────────────────────────────────────────────────── */

export default function App() {
  const {
    client,
    conversations,
    messages,
    peerInboxIds,
    loading,
    error: xmtpError,
    initClient,
    resetClient,
    sendMessage,
    loadMessages,
    streamMessages,
    startNewConversation,
  } = useXMTP();

  const { connect, disconnect, account, connected, wallets } = useWallet();

  const [activeConvo, setActiveConvo] = useState<Dm | null>(null);
  const [inputText, setInputText] = useState("");
  const [newConvoAddress, setNewConvoAddress] = useState("");
  const [showNewConvoModal, setShowNewConvoModal] = useState(false);
  const [appStatus, setAppStatus] = useState<AppStatus>("disconnected");
  const [statusError, setStatusError] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Guard against double XMTP init
  const xmtpInitRef = useRef(false);

  // Store the derived EVM address for display
  const [evmAddress, setEvmAddress] = useState<string | null>(null);

  /* ── wallet connect ──────────────────────────────────────────────────── */

  const handleConnect = async () => {
    try {
      setAppStatus("connecting");
      setStatusError(null);

      if (!connected) {
        // Pick first available wallet (Petra auto-registers via AIP-62)
        const target = wallets[0];
        if (!target) {
          setStatusError(
            "No Aptos wallet found. Please install an Aptos wallet extension."
          );
          setAppStatus("error");
          return;
        }
        await connect(target.name);
        // After connect(), the useEffect below handles XMTP init
      } else if (account && !client) {
        // Retry path — wallet connected but XMTP failed previously
        xmtpInitRef.current = false;
        await initXMTP();
      }
    } catch (err: unknown) {
      console.error("Connection error:", err);
      setStatusError(errMsg(err, "Wallet connection failed"));
      setAppStatus("error");
    }
  };

  /* ── XMTP init (no signMessage!) ─────────────────────────────────────── */

  const initXMTP = useCallback(async () => {
    if (!account || xmtpInitRef.current) return;
    xmtpInitRef.current = true;
    setAppStatus("initializing_xmtp");
    setStatusError(null);

    try {
      const aptosAddr = account.address.toString();
      const evmWallet = getOrCreateEvmWallet(aptosAddr);
      // Display the lowercase version — this is how it's registered on XMTP
      setEvmAddress(evmWallet.address.toLowerCase());

      const signer = createXmtpSigner(evmWallet);
      await initClient(signer);
      setAppStatus("ready");
    } catch (err: unknown) {
      console.error("XMTP init error:", err);
      setStatusError(errMsg(err, "Failed to initialise XMTP"));
      setAppStatus("error");
      xmtpInitRef.current = false; // allow retry
    }
  }, [account, initClient]);

  /** Auto-init when wallet connects */
  useEffect(() => {
    if (connected && account && !client) {
      initXMTP();
    }
    if (!connected && !account) {
      xmtpInitRef.current = false;
    }
  }, [connected, account, client, initXMTP]);

  /* ── disconnect ──────────────────────────────────────────────────────── */

  const handleDisconnect = async () => {
    xmtpInitRef.current = false;
    await resetClient();
    await disconnect();
    setActiveConvo(null);
    setEvmAddress(null);
    setAppStatus("disconnected");
    setStatusError(null);
  };

  /* ── conversation selection ──────────────────────────────────────────── */

  useEffect(() => {
    if (activeConvo) {
      loadMessages(activeConvo);
      streamMessages(activeConvo);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeConvo]);

  /* ── auto-scroll ─────────────────────────────────────────────────────── */

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, activeConvo]);

  /* ── send ─────────────────────────────────────────────────────────────── */

  const handleSend = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!inputText.trim() || !activeConvo) return;
    const text = inputText;
    setInputText("");
    await sendMessage(activeConvo, text);
  };

  /* ── new conversation ────────────────────────────────────────────────── */

  const handleStartConversation = async () => {
    if (!newConvoAddress.trim()) return;
    const convo = await startNewConversation(newConvoAddress.trim());
    if (convo) {
      setActiveConvo(convo);
      setShowNewConvoModal(false);
      setNewConvoAddress("");
    }
  };

  /* ── copy EVM address to clipboard ───────────────────────────────────── */

  const handleCopyEvmAddress = async () => {
    if (!evmAddress) return;
    await navigator.clipboard.writeText(evmAddress);
    setCopiedAddr(true);
    setTimeout(() => setCopiedAddr(false), 2000);
  };

  /* ── Connect Screen ──────────────────────────────────────────────────── */

  if (!client) {
    const isConnecting = appStatus === "connecting";
    const isInitXMTP = appStatus === "initializing_xmtp";
    const busy = isConnecting || isInitXMTP;

    return (
      <div className="connect-container">
        <h1 className="logo-heading">ChattBox</h1>
        <p className="connect-subtitle">
          Secure, decentralized messaging on Aptos — powered by XMTP.
        </p>

        <button
          className="connect-button"
          onClick={handleConnect}
          disabled={busy}
        >
          {isConnecting ? (
            <>
              <span className="loading-dots">
                <span className="dot" />
                <span className="dot" />
                <span className="dot" />
              </span>
              Connecting Wallet…
            </>
          ) : isInitXMTP ? (
            <>
              <Loader2
                size={18}
                className="spinner"
                style={{ marginRight: 8 }}
              />
              Initializing XMTP…
            </>
          ) : (
            "Connect Wallet"
          )}
        </button>

        {(appStatus === "error" || xmtpError) && (
          <p className="error-text">{statusError || xmtpError}</p>
        )}
      </div>
    );
  }

  /* ── Main Chat UI ────────────────────────────────────────────────────── */

  return (
    <div className="app-container">
      {/* ── Sidebar ──────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>ChattBox</h1>
          <button
            className="icon-btn primary"
            onClick={() => setShowNewConvoModal(true)}
            title="New conversation"
          >
            <Plus size={18} />
          </button>
        </div>

        {/* EVM address banner */}
        {evmAddress && (
          <div className="evm-banner" onClick={handleCopyEvmAddress}>
            <span className="evm-label">Your XMTP address</span>
            <span className="evm-addr">
              {shorten(evmAddress, 8, 6)}
              {copiedAddr ? (
                <Check size={12} style={{ marginLeft: 4 }} />
              ) : (
                <Copy size={12} style={{ marginLeft: 4 }} />
              )}
            </span>
          </div>
        )}

        <div className="conversation-list">
          {conversations.length === 0 ? (
            <div className="empty-sidebar">
              No conversations yet. Start one!
            </div>
          ) : (
            conversations.map((convo) => {
              const peerId = peerInboxIds[convo.id] || convo.id;
              return (
                <div
                  key={convo.id}
                  className={`conversation-item ${activeConvo?.id === convo.id ? "active" : ""}`}
                  onClick={() => setActiveConvo(convo)}
                >
                  <div className="avatar">
                    {peerId.substring(0, 2).toUpperCase()}
                  </div>
                  <div className="convo-info">
                    <div className="convo-address">{shorten(peerId)}</div>
                    <div className="convo-last-msg">
                      {messages[convo.id]?.[
                        messages[convo.id].length - 1
                      ]?.content?.toString() ?? "No messages"}
                    </div>
                  </div>
                  <ChevronRight size={14} color="var(--text-muted)" />
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="sidebar-footer">
          <div className="avatar small">
            {client.inboxId?.substring(0, 2).toUpperCase()}
          </div>
          <div className="sidebar-footer-addr">
            {shorten(client.inboxId ?? "")}
          </div>
          <button
            onClick={handleDisconnect}
            className="icon-btn muted"
            title="Disconnect"
          >
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      {/* ── Chat Window ──────────────────────────────────────────────── */}
      <main className="chat-window">
        {activeConvo ? (
          <>
            <header className="chat-header">
              {(() => {
                const peerId =
                  peerInboxIds[activeConvo.id] || activeConvo.id;
                return (
                  <>
                    <div className="avatar" style={{ width: 36, height: 36 }}>
                      {peerId.substring(0, 2).toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div className="chat-header-name">
                        {shorten(peerId, 8, 8)}
                      </div>
                      <div className="chat-header-status">Online via XMTP</div>
                    </div>
                  </>
                );
              })()}
            </header>

            <div className="message-list" ref={scrollRef}>
              {(messages[activeConvo.id] ?? []).map((msg) => (
                <div
                  key={msg.id}
                  className={`message-bubble ${msg.senderInboxId === client.inboxId ? "sent" : "received"}`}
                >
                  {msg.content?.toString()}
                  <span className="message-time">
                    {msg.sentAt.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
              {loading && (
                <div style={{ textAlign: "center" }}>
                  <Loader2 className="spinner" size={20} />
                </div>
              )}
            </div>

            <form className="input-area" onSubmit={handleSend}>
              <div className="input-container">
                <input
                  className="chat-input"
                  placeholder="Type a message..."
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                />
                <button className="send-button" type="submit">
                  <Send size={18} />
                </button>
              </div>
            </form>
          </>
        ) : (
          <div className="empty-chat">
            <div className="empty-chat-icon">
              <MessageSquare size={40} color="var(--primary)" />
            </div>
            <h3>Your Messages</h3>
            <p>Select a conversation or start a new one to begin chatting.</p>
            {evmAddress && (
              <p className="evm-hint">
                Share your XMTP address with others so they can message you:
                <br />
                <code onClick={handleCopyEvmAddress} className="evm-code">
                  {evmAddress}
                  {copiedAddr ? (
                    <Check size={12} style={{ marginLeft: 4 }} />
                  ) : (
                    <Copy size={12} style={{ marginLeft: 4 }} />
                  )}
                </code>
              </p>
            )}
            <button
              className="connect-button small"
              onClick={() => setShowNewConvoModal(true)}
            >
              New Conversation
            </button>
          </div>
        )}
      </main>

      {/* ── New Conversation Modal ───────────────────────────────────── */}
      {showNewConvoModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 style={{ marginTop: 0 }}>New Chat</h2>
            <p className="modal-desc">
              Enter the recipient's XMTP / EVM address (0x…) to start a
              conversation.
            </p>
            <div
              className="input-container"
              style={{ borderRadius: 12, marginBottom: 20 }}
            >
              <Search size={18} color="var(--text-muted)" />
              <input
                className="chat-input"
                placeholder="0x..."
                value={newConvoAddress}
                onChange={(e) => setNewConvoAddress(e.target.value)}
                onKeyDown={(e) =>
                  e.key === "Enter" && handleStartConversation()
                }
              />
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <button
                className="connect-button secondary"
                onClick={() => setShowNewConvoModal(false)}
              >
                Cancel
              </button>
              <button
                className="connect-button"
                onClick={handleStartConversation}
                disabled={!newConvoAddress.trim()}
              >
                Start
              </button>
            </div>
            {xmtpError && <p className="error-text">{xmtpError}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
