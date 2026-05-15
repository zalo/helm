import { useEffect } from "react";
import { helmSocket } from "@/api/ws";
import { Topbar } from "@/workspace/Topbar";
import { Workspace } from "@/workspace/Workspace";
import { MobileView } from "@/workspace/MobileView";
import { useIsMobile } from "@/hooks/useMediaQuery";

export default function App() {
  const isMobile = useIsMobile();

  useEffect(() => {
    helmSocket.connect();
  }, []);

  return (
    <div className="flex h-full flex-col bg-bg-0">
      <Topbar isMobile={isMobile} />
      <main className="min-h-0 flex-1">
        {isMobile ? <MobileView /> : <Workspace />}
      </main>
    </div>
  );
}
