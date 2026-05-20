import React from 'react';
import { Pill, Activity, Stethoscope, Brain } from 'lucide-react';

interface WelcomeScreenProps {
  onPromptSelect: (text: string) => void;
  isTemporaryChat?: boolean;
  /** Shown in the default welcome headline instead of "User". */
  greetingName?: string;
}

export default function WelcomeScreen({
  onPromptSelect,
  isTemporaryChat = false,
  greetingName,
}: WelcomeScreenProps) {
  const displayName = greetingName?.trim() || "User";
  const suggestions = [
    { icon: <Pill size={24} />, title: "1,2-dipalmitoylphosphatidylcholine", text: "Tell me about this synthetic phospholipid used in liposomes to study biological membranes." },
    { icon: <Activity size={24} />, title: "1,4-alpha-Glucan Branching Enzyme", text: "What is this enzyme that catalyzes the transfer of a segment of a 1,4-alpha-glucan chain?" },
    { icon: <Stethoscope size={24} />, title: "1-Carboxyglutamic Acid", text: "What is the role of this acid found in various tissues and blood-clotting proteins?" },
    { icon: <Brain size={24} />, title: "1-Methyl-3-isobutylxanthine", text: "Explain this potent cyclic nucleotide phosphodiesterase inhibitor." },
  ];

  return (
    <div className="flex-1 relative flex flex-col items-center justify-center p-4 md:p-8 overflow-y-auto">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-28 -left-28 w-80 h-80 rounded-full bg-[rgba(201,100,66,0.06)] blur-3xl" />
        <div className="absolute top-1/3 -right-28 w-80 h-80 rounded-full bg-[rgba(176,174,165,0.08)] blur-3xl" />
      </div>

      <div className="mb-10 text-center relative">
        {isTemporaryChat ? (
          <>
            <h1
              className="font-semibold text-[var(--danger)] mb-4"
              style={{ fontSize: "var(--type-heading)", lineHeight: "var(--line-heading)" }}
            >
              Temporary chat
            </h1>
            <p className="type-body text-[var(--text-muted)] max-w-3xl">
              Temporary chats do not appear in recent conversations, are not used to personalize your experience, and are not used to train models.
              For safety and operations, content may be stored briefly and then deleted automatically.
            </p>
          </>
        ) : (
          <>
            <h1 className="type-display mb-4">
              Hello, {displayName}
            </h1>
            <p className="type-body text-[var(--text-muted)]">
              How can I help with your health today?
            </p>
          </>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-4xl w-full relative">
        {suggestions.map((item, idx) => (
          <button 
            key={idx}
            onClick={() => onPromptSelect(item.text)}
            className="flex flex-col p-6 rounded-[var(--radius-lg)] bg-[var(--surface-strong)] border border-[var(--border)] hover:border-[rgba(201,100,66,0.35)] hover:bg-[var(--state-hover-soft)] transition-colors duration-[var(--duration-base)] text-left group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--state-focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <div className="p-3 bg-[rgba(201,100,66,0.12)] text-[var(--accent)] rounded-[var(--radius-md)] w-fit mb-4">
              {item.icon}
            </div>
            <span className="type-section text-foreground">{item.title}</span>
            <span className="type-caption text-[var(--text-muted)] mt-2">{item.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
