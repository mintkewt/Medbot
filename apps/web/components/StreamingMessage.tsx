"use client";

import React from "react";
import { Bot } from "lucide-react";
import { motion } from "framer-motion";

interface StreamingMessageProps {
  content: string;
}

export default function StreamingMessage({ content }: StreamingMessageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 2 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.14, ease: [0.2, 0, 0, 1] }}
      className="flex gap-4 mb-6 justify-start"
    >
      <div className="w-8 h-8 rounded-[var(--radius-pill)] bg-[var(--surface)] border border-[var(--border)] flex items-center justify-center flex-shrink-0 mt-1">
        <Bot size={20} className="text-[var(--accent)]" />
      </div>

      <div className="max-w-[90%] md:max-w-[80%] flex flex-col items-start">
        <div className="pt-1 w-full">
          <div className="max-w-none type-body text-[var(--foreground)] whitespace-pre-wrap break-words">
            {content || ""}
            <span className="inline-block w-1.5 h-5 bg-[var(--accent)]/75 rounded-sm ml-0.5 align-text-bottom" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
