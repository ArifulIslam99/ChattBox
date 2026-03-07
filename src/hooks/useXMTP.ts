/**
 * useXMTP.ts
 *
 * React hook that manages the full XMTP client lifecycle:
 *   1. Client.create — registers or resumes an XMTP identity
 *   2. conversations.sync + syncAll — pull new conversations & messages from network
 *   3. listDms — get local DM conversations
 *   4. streamAllDmMessages — real-time incoming messages
 *   5. stream (conversations) — real-time new conversations
 *
 * Follows the official XMTP browser-sdk v6 documentation.
 */

import { useState, useCallback, useRef } from "react";
import { Client, IdentifierKind } from "@xmtp/browser-sdk";
import type {
  Signer,
  Dm,
  DecodedMessage,
  Conversation,
  AsyncStreamProxy,
} from "@xmtp/browser-sdk";

/* ── helpers ─────────────────────────────────────────────────────────────── */

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

/* ── hook ────────────────────────────────────────────────────────────────── */

export function useXMTP() {
  const [client, setClient] = useState<Client | null>(null);
  const [conversations, setConversations] = useState<Dm[]>([]);
  const [messages, setMessages] = useState<Record<string, DecodedMessage[]>>(
    {}
  );
  const [peerInboxIds, setPeerInboxIds] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stream refs so we can tear them down on cleanup
  const msgStreamRef = useRef<AsyncStreamProxy<DecodedMessage> | null>(null);
  const convoStreamRef = useRef<AsyncStreamProxy<Conversation> | null>(null);

  /* ── resolve peer inbox IDs for display ──────────────────────────────── */

  const resolvePeerInboxIds = useCallback(async (dms: Dm[]) => {
    const ids: Record<string, string> = {};
    for (const dm of dms) {
      try {
        ids[dm.id] = await dm.peerInboxId();
      } catch {
        ids[dm.id] = dm.id;
      }
    }
    setPeerInboxIds((prev) => ({ ...prev, ...ids }));
  }, []);

  /* ── init client ─────────────────────────────────────────────────────── */

  const initClient = useCallback(
    async (signer: Signer) => {
      try {
        setLoading(true);
        setError(null);

        const xmtp = await Client.create(signer, {
          env: "production",
          appVersion: "ChattBox/1.0",
        });

        setClient(xmtp);

        // Sync new conversations from the network, then list local DMs
        await xmtp.conversations.sync();

        const dms = await xmtp.conversations.listDms();
        setConversations(dms);
        await resolvePeerInboxIds(dms);

        return xmtp;
      } catch (err: unknown) {
        console.error("XMTP init error:", err);
        setError(errorMessage(err, "Failed to initialise XMTP"));
        return null;
      } finally {
        setLoading(false);
      }
    },
    [resolvePeerInboxIds]
  );

  /* ── reset (before disconnect) ───────────────────────────────────────── */

  const resetClient = useCallback(async () => {
    // Tear down active streams
    try {
      await msgStreamRef.current?.return();
    } catch {
      /* ignore */
    }
    try {
      await convoStreamRef.current?.return();
    } catch {
      /* ignore */
    }
    msgStreamRef.current = null;
    convoStreamRef.current = null;

    // Close the XMTP worker
    if (client) {
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }

    setClient(null);
    setConversations([]);
    setMessages({});
    setPeerInboxIds({});
    setError(null);
  }, [client]);

  /* ── load messages for a conversation ────────────────────────────────── */

  const loadMessages = useCallback(async (convo: Conversation) => {
    try {
      setLoading(true);
      await convo.sync();
      const msgs = await convo.messages();
      setMessages((prev) => ({ ...prev, [convo.id]: msgs }));
    } catch (err: unknown) {
      console.error("Load messages error:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  /* ── send a text message ─────────────────────────────────────────────── */

  const sendMessage = useCallback(
    async (convo: Conversation, text: string) => {
      try {
        await convo.sendText(text);

        // Re-read conversation so we get the official DecodedMessage from local DB
        const latest = await convo.messages({ limit: 1n });
        const msg = latest[0];
        if (msg) {
          setMessages((prev) => {
            const existing = prev[convo.id] ?? [];
            if (existing.some((m) => m.id === msg.id)) return prev;
            return { ...prev, [convo.id]: [...existing, msg] };
          });
        }
      } catch (err: unknown) {
        console.error("Send error:", err);
        setError(errorMessage(err, "Failed to send message"));
      }
    },
    []
  );

  /* ── stream messages for a conversation ──────────────────────────────── */

  const streamMessages = useCallback(
    async (convo: Conversation) => {
      if (!client) return;

      // Tear down previous msg stream
      try {
        await msgStreamRef.current?.return();
      } catch {
        /* ignore */
      }

      const stream = await client.conversations.streamAllDmMessages({
        onError: (err) => console.error("Message stream error:", err),
      });
      msgStreamRef.current = stream;

      // Process streamed messages in the background
      (async () => {
        for await (const msg of stream) {
          if (msgStreamRef.current !== stream) break; // replaced
          if (msg.conversationId === convo.id) {
            setMessages((prev) => {
              const existing = prev[convo.id] ?? [];
              if (existing.some((m) => m.id === msg.id)) return prev;
              return { ...prev, [convo.id]: [...existing, msg] };
            });
          }
        }
      })();
    },
    [client]
  );

  /* ── start a new DM ──────────────────────────────────────────────────── */

  const startNewConversation = useCallback(
    async (peerAddress: string) => {
      if (!client) return null;
      try {
        const raw = peerAddress.trim();

        // Always lowercase EVM addresses — XMTP identities are registered lowercase
        const target = raw.startsWith("0x") ? raw.toLowerCase() : raw;

        // Check reachability first using the instance method (inherits env)
        const identifier = {
          identifier: target,
          identifierKind: IdentifierKind.Ethereum,
        };
        const canMsg = await client.canMessage([identifier]);

        // The Map key may be normalised by the SDK, so check both forms
        const reachable = canMsg.get(target) ?? canMsg.get(raw) ?? false;

        if (!reachable) {
          setError(
            "This address is not registered on XMTP yet. " +
              "The recipient must connect to an XMTP app first."
          );
          return null;
        }

        let dm: Dm;
        if (target.startsWith("0x")) {
          dm = await client.conversations.createDmWithIdentifier(identifier);
        } else {
          // Assume it's an inbox ID
          dm = await client.conversations.createDm(target);
        }

        // Resolve peer inbox ID
        try {
          const pid = await dm.peerInboxId();
          setPeerInboxIds((prev) => ({ ...prev, [dm.id]: pid }));
        } catch {
          setPeerInboxIds((prev) => ({ ...prev, [dm.id]: target }));
        }

        setConversations((prev) => {
          if (prev.some((c) => c.id === dm.id)) return prev;
          return [dm, ...prev];
        });

        return dm;
      } catch (err: unknown) {
        console.error("New conversation error:", err);
        setError(errorMessage(err, "Failed to start conversation"));
        return null;
      }
    },
    [client]
  );

  /* ── public API ──────────────────────────────────────────────────────── */

  return {
    client,
    conversations,
    messages,
    peerInboxIds,
    loading,
    error,
    initClient,
    resetClient,
    sendMessage,
    loadMessages,
    streamMessages,
    startNewConversation,
  } as const;
}
