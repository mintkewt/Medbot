import React from 'react';
import { User, Bot, FileText, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { motion } from 'framer-motion';
import Image from 'next/image';

export type MessageRole = 'user' | 'bot';

export interface Attachment {
  name: string;
  type: 'image' | 'file';
  content: string;
  mimeType: string;
}

export interface Message {
  id: string;
  role: MessageRole;
  content: string;
  attachments?: Attachment[];
  timestamp: Date;
}

interface ChatMessageProps {
  message: Message;
}

export default function ChatMessage({ message }: ChatMessageProps) {
  const isUser = message.role === 'user';
  const files = message.attachments || [];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
      className={`flex gap-4 mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}
    >
        {!isUser && (
            <div className="w-8 h-8 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 mt-1">
                <Bot size={20} className="text-[var(--accent)]" />
            </div>
        )}

        <div className={`max-w-[90%] md:max-w-[80%] flex flex-col ${isUser ? 'items-end' : 'items-start'}`}>
            
            {/* Attachments (vertical list) */}
            {files.length > 0 && (
                <div className={`flex flex-col gap-2 mb-2 w-full ${isUser ? 'items-end' : 'items-start'}`}>
                    {files.map((att, index) => (
                        <div key={index} className="relative group w-full sm:w-auto">
                            {att.type === 'image' ? (
                                // Image preview
                                <div className="max-w-[280px] rounded-[var(--radius-md)] overflow-hidden border border-[var(--border)] shadow-sm bg-[var(--surface)]">
                                    <Image
                                      src={att.content}
                                      alt="Uploaded"
                                      width={280}
                                      height={210}
                                      unoptimized
                                      className="w-full h-auto object-cover"
                                    />
                                </div>
                            ) : (
                                // File card
                                <div className="flex items-center gap-3 p-3 bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-lg)] min-w-[240px] max-w-[320px] shadow-sm hover:bg-[var(--state-hover-soft)] transition-colors duration-[var(--duration-base)] cursor-pointer">
                                    <div className="p-2.5 bg-[rgba(201,100,66,0.12)] rounded-[var(--radius-sm)] text-[var(--accent)] flex-shrink-0">
                                        <FileText size={24} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="type-body font-medium text-[var(--foreground)] truncate" title={att.name}>
                                            {att.name}
                                        </div>
                                        <div className="type-caption text-[var(--text-subtle)] uppercase tracking-wide mt-0.5">
                                            {att.mimeType.split('/')[1] || 'DOCUMENT'}
                                        </div>
                                    </div>
                                    <button
                                      className="p-2 rounded-[var(--radius-pill)] text-[var(--text-subtle)] hover:bg-[var(--state-hover)] hover:text-[var(--accent)] transition-colors duration-[var(--duration-base)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                                    >
                                        <Download size={18} />
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Message body */}
            {message.content && (
                <div className={`${
                    isUser 
                    ? 'bg-[var(--surface)] px-5 py-3 rounded-[var(--radius-xl)] border border-[var(--border)] text-[var(--foreground)]' 
                    : 'bg-[var(--surface-strong)] px-5 py-3 rounded-[var(--radius-xl)] border border-[var(--border-soft)] text-[var(--foreground)]'
                }`}>
                    <div className={`prose dark:prose-invert prose-sm max-w-none type-body ${isUser ? 'prose-p:text-[var(--foreground)]' : 'prose-p:text-[var(--foreground)]'}`}>
                        <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
                            {message.content}
                        </ReactMarkdown>
                    </div>
                </div>
            )}
        </div>

        {isUser && (
            <div className="w-8 h-8 rounded-[var(--radius-pill)] bg-[rgba(201,100,66,0.12)] border border-[rgba(201,100,66,0.24)] flex items-center justify-center flex-shrink-0 mt-1">
                <User size={20} className="text-[var(--accent)]" />
            </div>
        )}
    </motion.div>
  );
}