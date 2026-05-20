import ChatWorkspace from "@/components/ChatWorkspace";
import ProtectedChatGate from "@/components/ProtectedChatGate";

type SessionPageProps = {
  params: Promise<{
    sessionId: string;
  }>;
};

export default async function SessionPage({ params }: SessionPageProps) {
  const { sessionId } = await params;
  return (
    <ProtectedChatGate>
      <ChatWorkspace initialSessionId={sessionId} />
    </ProtectedChatGate>
  );
}

