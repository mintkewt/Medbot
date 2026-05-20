import React, { useEffect, useRef, useState } from "react";
import { Check, MessageSquare, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Pin, Plus, Search, Settings, Trash2, X } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/cn";
import { ModalShell } from "@/components/ui/ModalShell";
import { Button } from "@/components/ui/Button";

interface SidebarV2Props {
  isOpen: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onToggleCollapse: () => void;
  onNewChat: () => void;
  onStartTemporaryChat: () => void;
  onOpenSettings: () => void;
  conversations: Array<{ sessionId: string; title: string; updatedAt?: string; isPinned?: boolean }>;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string) => void;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  onLoadMoreConversations: () => Promise<void> | void;
  hasMoreConversations: boolean;
  isLoadingMoreConversations: boolean;
  onRenameSession: (sessionId: string, title: string) => Promise<void> | void;
  onTogglePinSession: (sessionId: string, pinned: boolean) => Promise<void> | void;
  onDeleteSession: (sessionId: string) => Promise<void> | void;
  isMutatingSession?: Record<string, boolean>;
}

export default function SidebarV2(props: SidebarV2Props) {
  const {
    isOpen, collapsed, onToggle, onToggleCollapse, onNewChat, onOpenSettings, conversations,
    onStartTemporaryChat,
    activeSessionId, onSelectSession, searchQuery, onSearchQueryChange, onRenameSession,
    onTogglePinSession, onDeleteSession, isMutatingSession,
    onLoadMoreConversations, hasMoreConversations, isLoadingMoreConversations,
  } = props;
  const activeTab = "chats" as const;
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const loadingMoreRef = useRef(false);

  // Intentionally no document listener (avoids teardown races with late click events).
  useEffect(() => {
    // Placeholder effect to keep hook order stable if we add listeners later.
  }, []);

  const handleSidebarScroll = async (event: React.UIEvent<HTMLDivElement>) => {
    if (collapsed || activeTab !== "chats") return;
    if (!hasMoreConversations || isLoadingMoreConversations || loadingMoreRef.current) return;
    const target = event.currentTarget;
    const remain = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (remain > 80) return;
    loadingMoreRef.current = true;
    try {
      await onLoadMoreConversations();
    } finally {
      loadingMoreRef.current = false;
    }
  };

  return (
    <>
      {isOpen && <div onClick={onToggle} className="fixed inset-0 bg-black/45 z-30 md:hidden" />}
      <div className={`fixed md:relative z-40 h-full flex flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-all duration-[var(--duration-base)] ease-[var(--ease-standard)] ${isOpen ? (collapsed ? "w-[84px] translate-x-0" : "w-[296px] translate-x-0") : "w-[296px] -translate-x-full md:w-0 md:translate-x-0 md:overflow-hidden"}`}>
        <div className="p-4 pt-4 space-y-3">
          <div className={`flex items-center ${collapsed ? "justify-between" : "justify-between"}`}>
            {!collapsed && (
              <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius-pill)] border border-[var(--border)] bg-[var(--surface-strong)]">
                <Image src="/favicon-mono-dark.svg" alt="Medbot Logo" width={24} height={24} className="w-6 h-6 dark:hidden" />
                <Image src="/favicon-mono-light.svg" alt="Medbot Logo" width={24} height={24} className="hidden w-6 h-6 dark:block" />
                <span className="type-caption font-semibold">Medbot</span>
              </div>
            )}
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleCollapse}
                aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
                className="hidden md:flex p-2 rounded-[var(--radius-pill)] hover:bg-[var(--state-hover)] transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]"
              >
                {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
              </button>
              <button onClick={onToggle} className="p-2 rounded-[var(--radius-pill)] hover:bg-[var(--state-hover)] transition-colors duration-[var(--duration-fast)] md:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]">
                <X size={18} />
              </button>
            </div>
          </div>
          <button onClick={onNewChat} className={`group flex items-center ${collapsed ? "justify-center" : "gap-3 px-4"} py-2 rounded-[var(--radius-pill)] type-caption font-semibold bg-[var(--surface-strong)] text-[var(--foreground)] w-full border border-[var(--border)] transition-colors duration-[var(--duration-base)] hover:bg-[var(--state-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]`}>
            <div className="p-1.5 rounded-[var(--radius-pill)] text-[var(--accent)] bg-[rgba(201,100,66,0.12)]"><Plus size={16} /></div>
            {!collapsed && <span>New chat</span>}
          </button>
          <button
            onClick={onStartTemporaryChat}
            className={`group flex items-center ${collapsed ? "justify-center" : "gap-3 px-4"} py-2 rounded-[var(--radius-pill)] type-caption font-semibold bg-[rgba(181,51,51,0.10)] text-[var(--danger)] w-full border border-[rgba(181,51,51,0.35)] transition-colors duration-[var(--duration-base)] hover:bg-[rgba(181,51,51,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]`}
            aria-label="Start temporary chat"
          >
            <span className="inline-flex items-center justify-center w-7 h-7 rounded-[var(--radius-pill)] bg-[rgba(181,51,51,0.16)]">
              <svg viewBox="0 0 24 23" fill="none" xmlns="http://www.w3.org/2000/svg" width="16" height="16" aria-hidden="true">
                <path d="M2.39941 18.6357L3.24023 17.7109C3.51304 17.4109 3.90015 17.2394 4.30566 17.2393H7.19922V19.6396H4.72949L2.50586 22.0869C1.62048 23.0608 -0.000976507 22.4344 -0.000976562 21.1182V14.8389H2.39941V18.6357ZM14.3994 19.6396H9.59961V17.2393H14.3994V19.6396ZM24.001 17.2393C24.0009 18.5647 22.9251 19.6396 21.5996 19.6396H16.7998L16.8008 17.2393H21.6006V14.8398H24.001V17.2393ZM2.40039 12.4395H0V7.63965H2.40039V12.4395ZM24 12.4395H21.5996V7.63965H24V12.4395ZM7.2002 2.83984H2.40039V5.23926H0V2.83984C0 1.51436 1.07491 0.439453 2.40039 0.439453H7.2002V2.83984ZM21.6006 0.439453C22.9258 0.439717 24 1.51452 24 2.83984V5.23926H21.5996V2.83984H16.7998L16.8008 0.439453H21.6006ZM14.3994 2.83984H9.59961V0.439453H14.3994V2.83984Z" fill="currentColor"></path>
              </svg>
            </span>
            {!collapsed && <span>Temporary chat</span>}
          </button>
        </div>

        {!collapsed && (
          <>
            <div className="px-4 pb-2">
              <div className="relative group">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-subtle)]" />
                <input type="text" placeholder="Search..." value={searchQuery} onChange={(e) => onSearchQueryChange(e.target.value)} className="w-full border border-[var(--border)] rounded-[var(--radius-md)] py-2.5 pl-9 pr-4 type-caption bg-[var(--surface-strong)] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]" />
              </div>
            </div>
          </>
        )}

        <div className="flex-1 overflow-y-auto p-2 scrollbar-thin" onScroll={handleSidebarScroll}>
          {activeTab === "chats" ? (
            <div className="space-y-1">
              {!collapsed && <div className="type-caption font-semibold text-[var(--text-subtle)] mb-2 px-3 mt-2">Recent</div>}
              {conversations.length > 0 ? conversations.map((item) => (
                <div key={item.sessionId} className={cn("w-full p-3 rounded-[var(--radius-md)] type-caption flex items-center gap-2 transition-colors duration-[var(--duration-base)] group border border-transparent", activeSessionId === item.sessionId ? "bg-[rgba(201,100,66,0.10)] border-[rgba(201,100,66,0.35)]" : "hover:bg-[var(--state-hover-soft)]")}>
                  <button onClick={() => onSelectSession(item.sessionId)} className={cn("flex-1 min-w-0 flex items-center", collapsed ? "justify-center" : "gap-3 text-left")}>
                    <MessageSquare size={18} />
                    {!collapsed && (editingSessionId === item.sessionId ? (
                      <input 
                        className="flex-1 min-w-0 bg-[var(--surface-strong)] border border-[var(--border)] rounded-[var(--radius-sm)] px-2 py-1 type-caption" 
                        value={editingTitle} 
                        onChange={(e) => setEditingTitle(e.target.value)} 
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={async (e) => {
                          if (e.key === 'Escape') {
                            setEditingSessionId(null);
                            setEditingTitle('');
                          }
                          if (e.key === 'Enter') {
                            const cleaned = editingTitle.trim();
                            if (cleaned) await onRenameSession(item.sessionId, cleaned);
                            setEditingSessionId(null);
                            setEditingTitle('');
                          }
                        }}
                        autoFocus 
                      />
                    ) : (
                      <>
                        <span className="truncate type-caption font-medium">{item.title}</span>
                        {item.isPinned && <Pin size={14} className="text-[var(--accent)] shrink-0" fill="currentColor" />}
                      </>
                    ))}
                  </button>
                  {!collapsed && editingSessionId === item.sessionId ? (
                    <button onClick={async () => { const cleaned = editingTitle.trim(); if (cleaned) await onRenameSession(item.sessionId, cleaned); setEditingSessionId(null); setEditingTitle(""); }} className="p-1 rounded-[var(--radius-pill)] hover:bg-[var(--state-hover)] transition-colors duration-[var(--duration-fast)]"><Check size={14} /></button>
                  ) : (
                    !collapsed && (
                      <div className="relative">
                        <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(openMenuId === item.sessionId ? null : item.sessionId); }} className="session-menu-trigger p-1 rounded-[var(--radius-pill)] opacity-0 group-hover:opacity-100 transition-opacity duration-[var(--duration-fast)]"><MoreHorizontal size={14} /></button>
                        {openMenuId === item.sessionId && (
                          <>
                            <div className="fixed inset-0 z-10" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpenMenuId(null); }} />
                            <div 
                              className="absolute right-0 top-7 z-20 w-44 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface-strong)] p-1 shadow-md"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--state-hover)] type-caption transition-colors duration-[var(--duration-fast)]" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setEditingSessionId(item.sessionId); setEditingTitle(item.title); setOpenMenuId(null); }}><Pencil size={14} /> Rename</button>
                              <button className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[var(--state-hover)] type-caption transition-colors duration-[var(--duration-fast)]" onClick={async (e) => { e.preventDefault(); e.stopPropagation(); await onTogglePinSession(item.sessionId, !Boolean(item.isPinned)); setOpenMenuId(null); }}><Pin size={14} /> {item.isPinned ? "Unpin" : "Pin"}</button>
                              <button className="w-full flex items-center gap-2 text-left px-3 py-2 rounded-[var(--radius-sm)] hover:bg-[rgba(181,51,51,0.12)] type-caption text-[var(--danger)] transition-colors duration-[var(--duration-fast)]" onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDeleteConfirmId(item.sessionId); setOpenMenuId(null); }}><Trash2 size={14} /> Delete</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  )}
                  {!collapsed && isMutatingSession?.[item.sessionId] && <span className="text-[10px]">...</span>}
                </div>
              )) : <div className="text-center type-caption text-[var(--text-subtle)] mt-8 italic">{collapsed ? "" : "No results"}</div>}
              {!collapsed && activeTab === "chats" && isLoadingMoreConversations && (
                <div className="px-3 py-2 type-caption text-[var(--text-subtle)]">Loading more conversations...</div>
              )}
            </div>
          ) : null}
        </div>
        <div className="p-3 border-t border-[var(--border)] bg-[var(--surface-strong)]">
          <button onClick={onOpenSettings} className={`flex items-center w-full p-3 rounded-[var(--radius-pill)] hover:bg-[var(--state-hover)] transition-colors duration-[var(--duration-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--surface)]`}>
            <Settings size={20} />
            {!collapsed && <span className="type-caption">Settings</span>}
          </button>
        </div>
      </div>

      <ModalShell
        isOpen={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete conversation"
        maxWidthClassName="max-w-sm"
      >
        <div className="p-5 space-y-6">
          <p className="type-body text-[var(--text-muted)]">
            Delete this conversation? This cannot be undone.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="text" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
            <Button 
              variant="filled" 
              className="bg-[var(--danger)] text-[var(--accent-foreground)] hover:bg-[var(--danger)]/85 shadow-none" 
              onClick={async () => {
                if (deleteConfirmId) {
                  await onDeleteSession(deleteConfirmId);
                }
                setDeleteConfirmId(null);
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      </ModalShell>
    </>
  );
}

