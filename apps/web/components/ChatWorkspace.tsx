"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { Menu, WifiOff } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import SidebarV2 from "@/components/SidebarV2";
import ChatMessage from "@/components/ChatMessage";
import ChatInput from "@/components/ChatInput";
import WelcomeScreen from "@/components/WelcomeScreen";
import StreamingMessage from "@/components/StreamingMessage";
import SettingsModal from "@/components/SettingsModal";
import { useChat } from "@/hooks/useChat";
import { Chip } from "@/components/ui/Chip";
import { API_URL } from "@/lib/env";
import { authHeaderFields } from "@/lib/authStorage";
import { useAuth } from "@/components/AuthProvider";

type Props = {
  initialSessionId?: string | null;
};

type ConversationItem = {
  sessionId: string;
  title: string;
  updatedAt?: string;
  isPinned?: boolean;
};

const DEFAULT_SESSION_TITLE = "New conversation";
const SESSION_LIST_CACHE_TTL_MS = 60_000;
const SESSION_PAGE_SIZE = 50;
let sessionListCache: {
  data: ConversationItem[] | null;
  fetchedAt: number;
} = {
  data: null,
  fetchedAt: 0,
};

export default function ChatWorkspace({ initialSessionId = null }: Props) {
  const [input, setInput] = useState("");
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isTemporaryChat, setIsTemporaryChat] = useState(false);
  const [isMutatingSession, setIsMutatingSession] = useState<Record<string, boolean>>({});
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const [isLoadingMoreConversations, setIsLoadingMoreConversations] = useState(false);
  const [isListAuthExpired, setIsListAuthExpired] = useState(false);
  const router = useRouter();
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const {
    messages,
    isLoading,
    isSessionLoading,
    isConnected,
    isAuthExpired,
    streamingContent,
    sendMessage,
    clearMessages,
    sessionId,
    loadSessionHistory,
  } = useChat();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [conversations, setConversations] = useState<ConversationItem[]>(
    () => sessionListCache.data || []
  );
  const conversationsRef = useRef<ConversationItem[]>(sessionListCache.data || []);
  const inFlightSessionListRef = useRef<Map<string, Promise<ConversationItem[]>>>(new Map());
  const titleRefreshAttemptsRef = useRef<Record<string, number>>({});
  const unauthorizedRedirectedRef = useRef(false);

  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);

  const refreshConversations = useCallback(async (options?: { force?: boolean; query?: string; append?: boolean }) => {
    const force = options?.force === true;
    const append = options?.append === true;
    const query = options?.query ?? searchQuery;
    const now = Date.now();
    const cacheIsFresh =
      !query &&
      !!sessionListCache.data &&
      now - sessionListCache.fetchedAt < SESSION_LIST_CACHE_TTL_MS;

    if (!append && !force && cacheIsFresh) {
      setConversations(sessionListCache.data || []);
      return sessionListCache.data || [];
    }

    try {
      const params = new URLSearchParams();
      params.set("limit", String(SESSION_PAGE_SIZE));
      const currentConversations = conversationsRef.current;
      params.set("offset", append ? String(currentConversations.length) : "0");
      if (query) {
        params.set("q", query);
      }
      const requestKey = `${force ? "1" : "0"}:${append ? "1" : "0"}:${query}:${params.get("offset")}`;
      const existingPromise = inFlightSessionListRef.current.get(requestKey);
      if (existingPromise) {
        return existingPromise;
      }
      const requestPromise = (async () => {
        const res = await fetch(`${API_URL}/api/chat/sessions?${params.toString()}`, {
          method: "GET",
          headers: { ...authHeaderFields() },
          cache: "no-store",
        });
        if (res.status === 401) {
          setIsListAuthExpired(true);
          return [];
        }
        setIsListAuthExpired(false);
        if (!res.ok) return [];
        const payload = (await res.json()) as {
          sessions?: ConversationItem[];
          pagination?: { total?: number };
        };
        const next = payload.sessions || [];
        const total = payload.pagination?.total;
        if (append) {
          const merged = [...conversationsRef.current];
          for (const row of next) {
            if (!merged.some((item) => item.sessionId === row.sessionId)) {
              merged.push(row);
            }
          }
          setConversations(merged);
          setHasMoreConversations(typeof total === "number" ? merged.length < total : next.length >= SESSION_PAGE_SIZE);
          return merged;
        }
        if (!query) {
          sessionListCache = {
            data: next,
            fetchedAt: now,
          };
        }
        setConversations(next);
        setHasMoreConversations(typeof total === "number" ? next.length < total : next.length >= SESSION_PAGE_SIZE);
        return next;
      })();
      inFlightSessionListRef.current.set(requestKey, requestPromise);
      void requestPromise.finally(() => {
        if (inFlightSessionListRef.current.get(requestKey) === requestPromise) {
          inFlightSessionListRef.current.delete(requestKey);
        }
      });
      const result = await requestPromise;
      return result;
    } catch {
      return [];
    }
  }, [searchQuery]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading, streamingContent]);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => {
      if (mq.matches) setIsSidebarOpen(false);
    };
    queueMicrotask(sync);
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    if (conversations.length > 0) return;
    const t = window.setTimeout(() => {
      void refreshConversations();
    }, 0);
    return () => window.clearTimeout(t);
  }, [conversations.length, refreshConversations]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refreshConversations({ force: true, query: searchQuery.trim() });
    }, 250);
    return () => window.clearTimeout(t);
  }, [searchQuery, refreshConversations]);

  useEffect(() => {
    if (!initialSessionId) return;
    if (sessionId === initialSessionId && messages.length > 0) return;
    if (unauthorizedRedirectedRef.current) return;
    void (async () => {
      const status = await loadSessionHistory(initialSessionId);
      if (status === "unauthorized") {
        unauthorizedRedirectedRef.current = true;
        clearMessages();
        logout();
        router.replace("/login");
      }
    })();
  }, [clearMessages, initialSessionId, loadSessionHistory, logout, messages.length, router, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    if (pathname === "/") {
      window.history.replaceState(null, "", `/${sessionId}`);
    }
  }, [sessionId, pathname]);

  useEffect(() => {
    if (!sessionId) return;
    const alreadyInList = conversations.some((c) => c.sessionId === sessionId);
    if (alreadyInList) return;
    const t = window.setTimeout(() => {
      void refreshConversations({ force: true });
    }, 700);
    return () => window.clearTimeout(t);
  }, [sessionId, conversations, refreshConversations]);

  const activeSessionId = initialSessionId || sessionId;
  const activeSessionTitle =
    conversations.find((c) => c.sessionId === activeSessionId)?.title || "Medbot";
  const shouldShowSessionLoading =
    Boolean(initialSessionId) &&
    (isSessionLoading || (sessionId !== initialSessionId && messages.length === 0 && !streamingContent));

  useEffect(() => {
    if (!activeSessionId) return;
    if (messages.length === 0 || isLoading || !!streamingContent) return;

    const activeConversation = conversations.find((c) => c.sessionId === activeSessionId);
    if (!activeConversation) return;
    if (activeConversation.title !== DEFAULT_SESSION_TITLE) {
      delete titleRefreshAttemptsRef.current[activeSessionId];
      return;
    }

    const attempts = titleRefreshAttemptsRef.current[activeSessionId] || 0;
    if (attempts >= 3) return;

    const timer = window.setTimeout(() => {
      titleRefreshAttemptsRef.current[activeSessionId] = attempts + 1;
      void refreshConversations({ force: true, query: searchQuery.trim() });
    }, 900);

    return () => window.clearTimeout(timer);
  }, [
    activeSessionId,
    conversations,
    isLoading,
    messages.length,
    refreshConversations,
    searchQuery,
    streamingContent,
  ]);

  const handleLoadMoreConversations = useCallback(async () => {
    if (!hasMoreConversations || isLoadingMoreConversations) return;
    setIsLoadingMoreConversations(true);
    try {
      await refreshConversations({ append: true, query: searchQuery.trim() });
    } finally {
      setIsLoadingMoreConversations(false);
    }
  }, [hasMoreConversations, isLoadingMoreConversations, refreshConversations, searchQuery]);

  const handleSend = (text: string = input) => {
    if (!text.trim()) return;
    void sendMessage(text);
    setInput("");
  };

  const cleanupTemporarySession = useCallback((sid: string) => {
    if (!sid) return;
    void fetch(`${API_URL}/api/chat/session/${sid}/cleanup`, {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", ...authHeaderFields() },
    }).catch(() => undefined);
  }, []);

  const resetChatAndNavigateHome = useCallback(
    (nextTemporaryState: boolean) => {
      if (isTemporaryChat && activeSessionId) {
        cleanupTemporarySession(activeSessionId);
      }
      clearMessages();
      setIsTemporaryChat(nextTemporaryState);
      router.push("/");
    },
    [activeSessionId, clearMessages, cleanupTemporarySession, isTemporaryChat, router]
  );

  const handleRenameSession = useCallback(
    async (sid: string, title: string) => {
      setIsMutatingSession((prev) => ({ ...prev, [sid]: true }));
      const prevData = conversations;
      const optimistic = prevData.map((item) => (item.sessionId === sid ? { ...item, title } : item));
      setConversations(optimistic);
      sessionListCache.data = optimistic;
      try {
        const res = await fetch(`${API_URL}/api/chat/session/${sid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaderFields() },
          body: JSON.stringify({ title }),
        });
        if (!res.ok) {
          throw new Error(`rename failed: ${res.status}`);
        }
        await refreshConversations({ force: true, query: searchQuery.trim() });
      } catch {
        setConversations(prevData);
        sessionListCache.data = prevData;
      } finally {
        setIsMutatingSession((prev) => ({ ...prev, [sid]: false }));
      }
    },
    [conversations, refreshConversations, searchQuery]
  );

  const handleTogglePinSession = useCallback(
    async (sid: string, pinned: boolean) => {
      setIsMutatingSession((prev) => ({ ...prev, [sid]: true }));
      const prevData = conversations;
      const optimistic = prevData.map((item) => (item.sessionId === sid ? { ...item, isPinned: pinned } : item));
      optimistic.sort((a, b) => {
        if (Boolean(a.isPinned) !== Boolean(b.isPinned)) {
          return Boolean(b.isPinned) ? 1 : -1;
        }
        return new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime();
      });
      setConversations(optimistic);
      sessionListCache.data = optimistic;
      try {
        const res = await fetch(`${API_URL}/api/chat/session/${sid}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", ...authHeaderFields() },
          body: JSON.stringify({ isPinned: pinned }),
        });
        if (!res.ok) {
          throw new Error(`pin failed: ${res.status}`);
        }
        await refreshConversations({ force: true, query: searchQuery.trim() });
      } catch {
        setConversations(prevData);
        sessionListCache.data = prevData;
      } finally {
        setIsMutatingSession((prev) => ({ ...prev, [sid]: false }));
      }
    },
    [conversations, refreshConversations, searchQuery]
  );

  const handleDeleteSession = useCallback(
    async (sid: string) => {
      setIsMutatingSession((prev) => ({ ...prev, [sid]: true }));
      const prevData = conversations;
      const optimistic = prevData.filter((item) => item.sessionId !== sid);
      setConversations(optimistic);
      sessionListCache.data = optimistic;
      try {
        const res = await fetch(`${API_URL}/api/chat/session/${sid}`, {
          method: "DELETE",
          headers: { ...authHeaderFields() },
        });
        if (!res.ok) {
          throw new Error(`delete failed: ${res.status}`);
        }
        if (activeSessionId === sid) {
          clearMessages();
          router.push("/");
        }
        await refreshConversations({ force: true, query: searchQuery.trim() });
      } catch {
        setConversations(prevData);
        sessionListCache.data = prevData;
      } finally {
        setIsMutatingSession((prev) => ({ ...prev, [sid]: false }));
      }
    },
    [activeSessionId, clearMessages, conversations, refreshConversations, router, searchQuery]
  );

  useEffect(() => {
    const handler = () => {
      if (!isTemporaryChat || !activeSessionId) return;
      cleanupTemporarySession(activeSessionId);
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [activeSessionId, cleanupTemporarySession, isTemporaryChat]);

  return (
    <div className="flex h-screen bg-background text-foreground font-sans overflow-hidden transition-colors relative">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 -left-28 w-80 h-80 rounded-full bg-[rgba(201,100,66,0.06)] blur-3xl" />
        <div className="absolute top-1/3 -right-28 w-80 h-80 rounded-full bg-[rgba(176,174,165,0.08)] blur-3xl" />
        <div className="absolute bottom-[-140px] left-1/3 w-80 h-80 rounded-full bg-[rgba(48,48,46,0.10)] blur-3xl" />
      </div>

      <SidebarV2
        isOpen={isSidebarOpen}
        collapsed={isSidebarCollapsed}
        onToggle={() => setIsSidebarOpen(!isSidebarOpen)}
        onToggleCollapse={() => setIsSidebarCollapsed((v) => !v)}
        onNewChat={() => {
          resetChatAndNavigateHome(false);
        }}
        onStartTemporaryChat={() => {
          resetChatAndNavigateHome(true);
        }}
        onOpenSettings={() => setIsSettingsOpen(true)}
        conversations={conversations}
        activeSessionId={activeSessionId}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        onLoadMoreConversations={handleLoadMoreConversations}
        hasMoreConversations={hasMoreConversations}
        isLoadingMoreConversations={isLoadingMoreConversations}
        onRenameSession={handleRenameSession}
        onTogglePinSession={handleTogglePinSession}
        onDeleteSession={handleDeleteSession}
        isMutatingSession={isMutatingSession}
        onSelectSession={(sid) => {
          if (isTemporaryChat && activeSessionId && sid !== activeSessionId) {
            cleanupTemporarySession(activeSessionId);
            setIsTemporaryChat(false);
          }
          router.push(`/${sid}`);
        }}
      />

      <div className="flex-1 flex flex-col relative h-full w-full">
        <header className="p-4 flex items-center justify-between absolute top-0 left-0 z-20 w-full pointer-events-none bg-[var(--background)]/90">
          <div className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-[var(--border)] to-transparent" />
          <div className="pointer-events-auto flex items-center gap-3">
            {!isSidebarOpen && (
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 rounded-[var(--radius-pill)] bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--state-hover)] shadow-sm transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                <Menu size={24} />
              </button>
            )}
            {!isConnected && (
              <Chip className="px-3 py-1.5">
                <WifiOff size={12} />
                <span>Connecting…</span>
              </Chip>
            )}
            {(isAuthExpired || isListAuthExpired) && (
              <Chip className="px-3 py-1.5 border-[rgba(181,51,51,0.35)] bg-[rgba(181,51,51,0.08)] text-[var(--danger)]">
                <span>Session expired. Please sign in again.</span>
              </Chip>
            )}
            {!isSidebarCollapsed && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)]">
                <Image
                  src="/favicon-mono-dark.svg"
                  alt="Medbot Logo"
                  width={24}
                  height={24}
                  className="w-6 h-6 dark:hidden"
                />
                <Image
                  src="/favicon-mono-light.svg"
                  alt="Medbot Logo"
                  width={24}
                  height={24}
                  className="hidden w-6 h-6 dark:block"
                />
                <span className="type-caption font-semibold">Medbot</span>
                {activeSessionId && (
                  <span className="type-caption text-[var(--text-subtle)]">
                    / {activeSessionTitle}
                  </span>
                )}
              </div>
            )}
            {isTemporaryChat && (
              <span className="px-3 py-1.5 rounded-[var(--radius-pill)] type-caption font-medium bg-[rgba(181,51,51,0.12)] text-[var(--danger)] border border-[rgba(181,51,51,0.26)]">
                Temporary chat
              </span>
            )}
          </div>
          <div className="pointer-events-auto w-10 h-10 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center">
            <Image src="/favicon.svg" alt="Medbot mark" width={20} height={20} className="w-5 h-5" />
          </div>
        </header>

        {shouldShowSessionLoading ? (
          <div className="flex-1 flex items-center justify-center pt-20">
            <div className="w-full max-w-2xl px-6 space-y-4">
              <div className="h-4 w-48 rounded-[var(--radius-pill)] bg-[var(--border)]" />
              <div className="h-16 w-full rounded-[var(--radius-lg)] bg-[var(--surface)]" />
              <div className="h-16 w-[88%] rounded-[var(--radius-lg)] bg-[var(--surface)]" />
              <div className="h-16 w-[76%] rounded-[var(--radius-lg)] bg-[var(--surface)]" />
            </div>
          </div>
        ) : messages.length === 0 && !streamingContent ? (
          <WelcomeScreen
            onPromptSelect={(text) => handleSend(text)}
            isTemporaryChat={isTemporaryChat}
            greetingName={
              user?.email
                ? user.email.split("@")[0].replace(/[._]/g, " ").trim() || "User"
                : undefined
            }
          />
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:px-20 lg:px-40 pt-20 pb-40 scroll-smooth scrollbar-thin">
            {messages.map((msg) => (
              <ChatMessage key={msg.id} message={msg} />
            ))}
            {streamingContent && <StreamingMessage content={streamingContent} />}
            {isLoading && !streamingContent && (
              <div className="px-2 mb-6">
                <div className="flex gap-4 items-start">
                  <div className="w-8 h-8 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center shrink-0">
                    <div className="flex gap-1">
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-[var(--radius-pill)] opacity-60" />
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-[var(--radius-pill)] opacity-80" />
                      <span className="w-1.5 h-1.5 bg-[var(--accent)] rounded-[var(--radius-pill)]" />
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}

        <ChatInput
          input={input}
          setInput={setInput}
          onSend={() => handleSend(input)}
          isLoading={isLoading}
        />
      </div>

      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

