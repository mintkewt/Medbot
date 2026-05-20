import React, { useRef, useState, useEffect } from 'react';
import { Send, Info, X, FileText } from 'lucide-react';
import TextareaAutosize from 'react-textarea-autosize';
import Image from 'next/image';
import { Attachment } from './ChatMessage';
import { Button } from '@/components/ui/Button';

interface ChatInputProps {
  input: string;
  setInput: (value: string) => void;
  onSend: (attachments: Attachment[]) => void;
  isLoading?: boolean;
}

export default function ChatInput({ input, setInput, onSend, isLoading = false }: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [selectedFiles, setSelectedFiles] = useState<Attachment[]>([]);

  useEffect(() => {
    if (!isLoading) textareaRef.current?.focus();
  }, [isLoading]);

  const processFiles = (files: FileList | File[]) => {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (ev.target?.result) {
            const isImage = file.type.startsWith('image/');
            const newAttachment: Attachment = {
                name: file.name,
                type: isImage ? 'image' : 'file',
                content: ev.target.result as string,
                mimeType: file.type
            };
            setSelectedFiles(prev => [...prev, newAttachment]);
          }
        };
        reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFiles(e.target.files);
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData.items;
    const filesToProcess: File[] = [];
    for (let i = 0; i < items.length; i++) {
        if (items[i].kind === 'file') {
            const file = items[i].getAsFile();
            if (file) filesToProcess.push(file);
        }
    }
    if (filesToProcess.length > 0) {
        e.preventDefault();
        processFiles(filesToProcess);
    }
  };

  const handleRemoveFile = (indexToRemove: number) => {
    setSelectedFiles(prev => prev.filter((_, index) => index !== indexToRemove));
  };

  const handleSendClick = () => {
    if ((!input.trim() && selectedFiles.length === 0) || isLoading) return;
    onSend(selectedFiles);
    setSelectedFiles([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    }
  };

  return (
    <div className="absolute bottom-0 left-0 w-full bg-[var(--background)] pt-2 pb-6 px-4 md:px-20 lg:px-40 transition-colors z-20">
        
        <div className="relative bg-[var(--surface-strong)] rounded-[var(--radius-lg)] px-4 py-3 shadow-sm border border-[var(--border)] focus-within:border-[var(--state-focus-ring)] transition-colors duration-[var(--duration-base)] ease-[var(--ease-standard)]">
            
            {/* Attachment previews */}
            {selectedFiles.length > 0 && (
                <div className="flex gap-3 mb-3 overflow-x-auto pb-2 scrollbar-thin px-1">
                    {selectedFiles.map((file, index) => (
                        <div key={index} className="relative flex-shrink-0 group mt-2"> 
                            
                            {file.type === 'image' ? (
                                <div className="h-20 w-20 rounded-[var(--radius-md)] border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                                    <Image
                                      src={file.content}
                                      alt="Preview"
                                      width={80}
                                      height={80}
                                      unoptimized
                                      className="w-full h-full object-cover"
                                    />
                                </div>
                            ) : (
                                <div className="h-20 w-32 flex flex-col justify-center items-center bg-[var(--surface)] border border-[var(--border)] rounded-[var(--radius-md)] p-2 shadow-sm">
                                    <FileText size={24} className="text-[var(--accent)] mb-1" />
                                    <span className="type-caption text-[var(--foreground)] w-full truncate text-center px-1 font-medium">{file.name}</span>
                                </div>
                            )}
                            
                            <button 
                                onClick={() => handleRemoveFile(index)}
                                className="absolute -top-2 -right-2 bg-[var(--surface)] rounded-[var(--radius-pill)] p-1 text-[var(--text-subtle)] hover:bg-[rgba(181,51,51,0.16)] hover:text-[var(--danger)] transition-colors duration-[var(--duration-base)] shadow-sm border border-[var(--border)] z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                            >
                                <X size={12} strokeWidth={3} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <div className="flex items-end gap-2">
                <input type="file" multiple ref={fileInputRef} className="hidden" accept="image/*,.pdf,.doc,.docx,.txt" onChange={handleFileSelect} />
                <TextareaAutosize
                    ref={textareaRef}
                    minRows={1}
                    maxRows={6}
                    placeholder="Ask a question about your medical history..."
                    className="flex-1 bg-transparent outline-none text-[var(--foreground)] type-body placeholder:text-[var(--text-subtle)] resize-none py-3"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    disabled={isLoading}
                />

                <Button
                  type="button"
                  onClick={handleSendClick}
                  disabled={(!input.trim() && selectedFiles.length === 0) || isLoading}
                  className="w-10 h-10 px-0 mb-1 flex items-center justify-center"
                  aria-label="Send message"
                >
                  <Send
                    size={18}
                    className="text-[var(--accent-foreground)] w-[18px] h-[18px] flex-shrink-0"
                  />
                </Button>
            </div>
        </div>
        
        <div className="text-center mt-3 flex items-center justify-center gap-1 type-caption text-[var(--text-subtle)]">
            <Info size={12} />
            <span>Medbot can make mistakes. Verify important information.</span>
        </div>
    </div>
  );
}