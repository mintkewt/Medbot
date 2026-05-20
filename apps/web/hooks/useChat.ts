"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { logger } from "@/lib/logger";
import { API_URL } from "@/lib/env";
import { authHeaderFields } from "@/lib/authStorage";
import type { Message, Attachment, MessageRole } from "@/components/ChatMessage";

interface UseChatReturn {
  messages: Message[];
  isLoading: boolean;
  isSessionLoading: boolean;
  isConnected: boolean;
  isAuthExpired: boolean;
  streamingContent: string;
  sendMessage: (text: string, files?: Attachment[]) => Promise<void>;
  clearMessages: () => void;
  sessionId: string | null;
  loadSessionHistory: (sessionId: string) => Promise<"ok" | "unauthorized" | "error" | "aborted">;
}

const chatRuntimeCache: {
  messages: Message[];
  isLoading: boolean;
  isSessionLoading: boolean;
  isConnected: boolean;
  isAuthExpired: boolean;
  streamingContent: string;
  sessionId: string | null;
} = {
  messages: [],
  isLoading: false,
  isSessionLoading: false,
  isConnected: true,
  isAuthExpired: false,
  streamingContent: "",
  sessionId: null,
};

function toUserMessage(kind: "stream" | "history" | "health"): string {
  if (kind === "history") {
    return "We could not load this conversation. Please try again later.";
  }
  if (kind === "health") {
    return "Chat is temporarily unavailable.";
  }
  return "We could not send your message. Please try again in a few minutes.";
}

function toAuthExpiredMessage(kind: "stream" | "history"): string {
  if (kind === "history") {
    return "Your login session has expired. Please sign in again to load this conversation.";
  }
  return "Your login session has expired. Please sign in again to continue chatting.";
}

function parseSseMessage(eventText: string): { event: string; data: string } | null {
  const lines = eventText.split("\n").map((line) => line.trim());
  const eventLine = lines.find((line) => line.startsWith("event:"));
  const dataLine = lines.find((line) => line.startsWith("data:"));
  if (!eventLine || !dataLine) return null;
  return {
    event: eventLine.replace("event:", "").trim(),
    data: dataLine.replace("data:", "").trim(),
  };
}

export function useChat(): UseChatReturn {
  const [messages, setMessages] = useState<Message[]>(() => chatRuntimeCache.messages);
  const [isLoading, setIsLoading] = useState(() => chatRuntimeCache.isLoading);
  const [isSessionLoading, setIsSessionLoading] = useState(() => chatRuntimeCache.isSessionLoading);
  const [isConnected, setIsConnected] = useState(() => chatRuntimeCache.isConnected);
  const [isAuthExpired, setIsAuthExpired] = useState(() => chatRuntimeCache.isAuthExpired);
  const [streamingContent, setStreamingContent] = useState(() => chatRuntimeCache.streamingContent);
  const sessionIdRef = useRef<string | null>(chatRuntimeCache.sessionId);
  const [sessionId, setSessionIdState] = useState<string | null>(() => chatRuntimeCache.sessionId);
  const activeControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    chatRuntimeCache.messages = messages;
    chatRuntimeCache.isLoading = isLoading;
    chatRuntimeCache.isSessionLoading = isSessionLoading;
    chatRuntimeCache.isConnected = isConnected;
    chatRuntimeCache.isAuthExpired = isAuthExpired;
    chatRuntimeCache.streamingContent = streamingContent;
    chatRuntimeCache.sessionId = sessionId;
  }, [messages, isLoading, isSessionLoading, isConnected, isAuthExpired, streamingContent, sessionId]);
  useEffect(() => {
    const verifyApiConnection = async () => {
      try {
        const response = await fetch(`${API_URL}/api/chat/health`, {
          method: "GET",
          cache: "no-store",
        });
        setIsConnected(response.ok);
      } catch (error) {
        logger.warn("http.health.failed", {
          message: error instanceof Error ? error.message : String(error),
        });
        setIsConnected(false);
      }
    };
    verifyApiConnection();

    return () => {
      activeControllerRef.current?.abort();
    };
  }, []);

  const applyStreamEvent = useCallback((eventName: string, payload: unknown) => {
    if (eventName === "stream_start") {
      setStreamingContent("");
      return;
    }

    if (eventName === "stream_chunk") {
      const chunk = (payload as { chunk?: string })?.chunk || "";
      setStreamingContent((prev) => prev + chunk);
      return;
    }

    if (eventName === "stream_end") {
      const fullAnswer = (payload as { fullAnswer?: string })?.fullAnswer || "";
      const botMsg: Message = {
        id: Date.now().toString(),
        role: "bot",
        content: fullAnswer,
        timestamp: new Date(),
      };
      // Commit the final message first so it renders immediately,
      // then clear the streaming overlay in a separate task (avoids React 18
      // batching stream_chunk + stream_end into a single render that never
      // shows the streaming content)
      setMessages((prev) => [...prev, botMsg]);
      setIsLoading(false);
      setTimeout(() => setStreamingContent(""), 0);
      return;
    }

    if (eventName === "stream_error") {
      setStreamingContent("");
      setIsLoading(false);
      const errorMsg: Message = {
        id: Date.now().toString(),
        role: "bot",
        content: "The system is busy. Please try again shortly.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    }
  }, []);


  const sendMessage = useCallback(
    async (text: string, files: Attachment[] = []) => {
      if (!text.trim() && files.length === 0) return;

      const userMsg: Message = {
        id: Date.now().toString(),
        role: "user",
        content: text,
        attachments: files.length > 0 ? files : undefined,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);
      setIsSessionLoading(false);
      setIsAuthExpired(false);
      setStreamingContent("");

      if (!sessionIdRef.current) {
        sessionIdRef.current = crypto.randomUUID();
        setSessionIdState(sessionIdRef.current);
      }

      logger.info("http.stream.request", {
        name: "chat_stream",
        sessionId: sessionIdRef.current,
        questionPreview: text.length > 200 ? `${text.slice(0, 200)}…` : text,
      });

      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        const response = await fetch(`${API_URL}/api/chat/stream`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            ...authHeaderFields(),
          },
          body: JSON.stringify({
            sessionId: sessionIdRef.current,
            question: text,
          }),
          // WARNING: Removed 'signal: controller.signal' because React 18 
          // Strict Mode double-invokes useEffect cleanup, instantly aborting 
          // the SSE stream right after it starts.
        });

        if (response.status === 401) {
          setIsAuthExpired(true);
          setIsLoading(false);
          setStreamingContent("");
          const authExpiredMsg: Message = {
            id: `${Date.now()}-stream-auth-expired`,
            role: "bot",
            content: toAuthExpiredMessage("stream"),
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, authExpiredMsg]);
          return;
        }

        if (!response.ok || !response.body) {
          throw new Error(`Stream request failed: ${response.status}`);
        }

        setIsConnected(true);
        setIsAuthExpired(false);
        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";

          for (const block of events) {
            if (!block.trim()) continue;
            const parsed = parseSseMessage(block);
            if (!parsed) continue;
            try {
              const payload = JSON.parse(parsed.data);
              applyStreamEvent(parsed.event, payload);
            } catch {
              logger.warn("http.stream.parse_error", { block });
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setIsConnected(false);
        setStreamingContent("");
        setIsLoading(false);
        logger.error("http.stream.error", {
          message: error instanceof Error ? error.message : String(error),
          apiUrl: API_URL,
        });
        const errorMsg: Message = {
          id: `${Date.now()}-stream-error`,
          role: "bot",
          content: toUserMessage("stream"),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMsg]);
      }
    },
    [applyStreamEvent]
  );

  const clearMessages = useCallback(() => {
    activeControllerRef.current?.abort();
    setMessages([]);
    setStreamingContent("");
    setIsLoading(false);
    setIsSessionLoading(false);
    sessionIdRef.current = null;
    setSessionIdState(null);
  }, []);

  const loadSessionHistory = useCallback(
    async (sid: string) => {
      activeControllerRef.current?.abort();
      setStreamingContent("");
      setIsLoading(false);
      setIsSessionLoading(true);

      const controller = new AbortController();
      activeControllerRef.current = controller;

      try {
        const response = await fetch(`${API_URL}/api/chat/session/${sid}/history`, {
          method: "GET",
          headers: { ...authHeaderFields() },
          cache: "no-store",
          signal: controller.signal,
        });

        if (response.status === 401) {
          setIsAuthExpired(false);
          return "unauthorized" as const;
        }

        if (!response.ok) {
          throw new Error(`History request failed: ${response.status}`);
        }
        setIsAuthExpired(false);

        const payload = (await response.json()) as {
          messages?: Array<{ role: MessageRole; content: string; timestamp?: string }>;
        };

        const rawMessages = payload.messages || [];

        const mapped: Message[] = rawMessages.map((m, idx) => ({
          id: `${sid}-${idx}-${m.role}`,
          role: m.role,
          content: m.content,
          timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        }));

        setMessages(mapped);
        sessionIdRef.current = sid;
        setSessionIdState(sid);
        return "ok" as const;
      } catch (error) {
        // Switching sessions quickly will abort the previous request.
        if (error instanceof DOMException && error.name === "AbortError") {
          return "aborted" as const;
        }
        if (String(error).includes("aborted")) {
          return "aborted" as const;
        }
        logger.error("http.history.error", {
          message: error instanceof Error ? error.message : String(error),
          sessionId: sid,
          apiUrl: API_URL,
        });
        const historyErrMsg: Message = {
          id: `${Date.now()}-history-error`,
          role: "bot",
          content: toUserMessage("history"),
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, historyErrMsg]);
        return "error" as const;
      } finally {
        setIsSessionLoading(false);
        // Keep controller for future requests; do not abort here.
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      }
    },
    []
  );

  return {
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
  };
}
