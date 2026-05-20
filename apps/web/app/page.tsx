import ChatWorkspace from "@/components/ChatWorkspace";
import ProtectedChatGate from "@/components/ProtectedChatGate";

export default function Home() {
  return (
    <ProtectedChatGate>
      <ChatWorkspace initialSessionId={null} />
    </ProtectedChatGate>
  );
}
