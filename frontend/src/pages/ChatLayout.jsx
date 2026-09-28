import { useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import ChatWindow from '../components/ChatWindow.jsx';
import ProfileModal from '../components/ProfileModal.jsx';
import { useChat } from '../context/ChatContext.jsx';
import { useTheme } from '../lib/theme.js';

export default function ChatLayout() {
  const { selectedPeerId } = useChat();
  const { isDark, toggle } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);

  return (
    <main className={`shell ${selectedPeerId ? 'has-thread' : ''}`}>
      <Sidebar
        onOpenSettings={() => setProfileOpen(true)}
        isDark={isDark}
        onToggleTheme={toggle}
      />
      <div className="thread-panel">
        <ChatWindow />
      </div>
      {profileOpen ? <ProfileModal onClose={() => setProfileOpen(false)} /> : null}
    </main>
  );
}