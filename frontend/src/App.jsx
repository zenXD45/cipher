import { useState } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ChatProvider } from './context/ChatContext.jsx';
import ChatLayout from './pages/ChatLayout.jsx';
import Login from './pages/Login.jsx';
import Signup from './pages/Signup.jsx';

function Gate() {
  const { user, ready } = useAuth();
  const [mode, setMode] = useState('login');

  if (!ready) {
    return (
      <div className="boot" role="status">
        <span className="boot-ring" aria-hidden="true" />
        <p>Opening the vault…</p>
      </div>
    );
  }

  if (user) {
    return (
      <ChatProvider>
        <ChatLayout />
      </ChatProvider>
    );
  }

  return mode === 'login' ? <Login onSwitch={() => setMode('signup')} /> : <Signup onSwitch={() => setMode('login')} />;
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}