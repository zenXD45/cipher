import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from '../lib/api.js';
import { API_BASE } from '../lib/config.js';
import { sealMessage } from '../lib/crypto.js';
import { useAuth } from './AuthContext.jsx';

const ChatContext = createContext(null);

export function ChatProvider({ children }) {
  const { user, ownKeys } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedPeerId, setSelectedPeerId] = useState(null);
  const [peer, setPeer] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [typingPeerId, setTypingPeerId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState(null);
  const [loadError, setLoadError] = useState(null);

  const socketRef = useRef(null);
  const typingTimer = useRef(null);
  const selectedRef = useRef(null);
  selectedRef.current = selectedPeerId;

  const refreshConversations = useCallback(async () => {
    try {
      const data = await api.conversations();
      setConversations(data.conversations);
    } catch {
      /* keep last known list */
    }
  }, []);

  const markUnreadInThread = useCallback(
    async (list) => {
      const unread = list.filter((m) => !m.mine && !m.read);
      await Promise.all(unread.map((m) => api.markRead(m.id).catch(() => null)));
      if (unread.length) refreshConversations();
    },
    [refreshConversations]
  );

  const openPeer = useCallback(
    async (peerId) => {
      setBusy(true);
      setLoadError(null);
      setSelectedPeerId(peerId);
      setMessages([]);
      try {
        const [{ user: profile }, thread] = await Promise.all([
          api.getUser(peerId),
          api.thread(peerId, null, 30)
        ]);
        setPeer({ id: profile.id, username: profile.username, avatar: profile.avatar, ...(profile.publicKey || {}) });
        setMessages(thread.messages);
        setHasOlder(thread.messages.length === 30);
        await markUnreadInThread(thread.messages);
      } catch (err) {
        setLoadError(err.message);
      } finally {
        setBusy(false);
      }
    },
    [markUnreadInThread]
  );

  const closePeer = useCallback(() => {
    setSelectedPeerId(null);
    setPeer(null);
    setMessages([]);
    setSendError(null);
    setLoadError(null);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!peer || messages.length === 0) return;
    const oldest = messages[0];
    try {
      const data = await api.thread(peer.id, oldest.id, 30);
      setMessages((prev) => [...data.messages, ...prev]);
      setHasOlder(data.messages.length === 30);
    } catch {
      /* no-op */
    }
  }, [peer, messages]);

  const send = useCallback(
    async (text) => {
      if (!peer || !ownKeys || busy) return false;
      if (!peer.publicKey) {
        setSendError('Recipient has not set up encryption yet');
        return false;
      }
      setBusy(true);
      setSendError(null);
      try {
        const sealed = await sealMessage(text, ownKeys.publicKey, peer.publicKey);
        const { message } = await api.sendMessage(peer.id, { ...sealed });
        if (!socketRef.current?.connected) {
          setMessages((prev) => [...prev, message]);
          refreshConversations();
        }
        return true;
      } catch (err) {
        setSendError(err.message);
        return false;
      } finally {
        setBusy(false);
      }
    },
    [peer, ownKeys, busy, refreshConversations]
  );

  const emitTyping = useCallback(
    (_peerId, state) => {
      if (socketRef.current?.connected && user) {
        socketRef.current.emit('typing', { to: _peerId, state });
      }
    },
    [user]
  );

  useEffect(() => {
    if (!user) return undefined;
    const socket = io(API_BASE || window.location.origin, {
      auth: { token: getToken() },
      transports: ['websocket']
    });
    socketRef.current = socket;

    socket.on('connect', () => refreshConversations());
    socket.on('message:new', (message) => {
      const open = selectedRef.current;
      const isForOpen =
        (message.mine ? String(message.recipientId) : String(message.senderId)) === open;
      if (open && isForOpen) {
        setMessages((prev) => [...prev, message]);
      }
      refreshConversations();
    });
    socket.on('read:update', ({ id }) => {
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
      refreshConversations();
    });
    socket.on('typing', ({ from }) => {
      setTypingPeerId(from);
      clearTimeout(typingTimer.current);
      typingTimer.current = setTimeout(() => setTypingPeerId(null), 1600);
    });
    socket.on('connect_error', () => {
      /* wait for the next reconnect attempt */
    });

    return () => {
      clearTimeout(typingTimer.current);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [user, refreshConversations]);

  const value = useMemo(
    () => ({
      conversations,
      selectedPeerId,
      peer,
      messages,
      hasOlder,
      typingPeerId,
      busy,
      sendError,
      loadError,
      openPeer,
      closePeer,
      loadOlder,
      send,
      emitTyping,
      refreshConversations
    }),
    [
      conversations,
      selectedPeerId,
      peer,
      messages,
      hasOlder,
      typingPeerId,
      busy,
      sendError,
      loadError,
      openPeer,
      closePeer,
      loadOlder,
      send,
      emitTyping,
      refreshConversations
    ]
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat() {
  return useContext(ChatContext);
}