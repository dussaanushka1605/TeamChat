import { io, Socket } from 'socket.io-client';

let socket: Socket | null = null;

const getSessionId = () => {
  if (typeof window === 'undefined') return undefined;
  let sid = sessionStorage.getItem('wsSessionId');
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem('wsSessionId', sid);
  }
  return sid;
};

export const initSocket = (token: string): Socket => {
  const sessionId = getSessionId();
  if (socket && socket.connected) {
    return socket;
  }

  const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5001';
  
  socket = io(API_URL, {
    auth: {
      token,
      sessionId,
    },
    transports: ['websocket']
  });

  return socket;
};

export const getSocket = (): Socket | null => {
  return socket;
};

export const disconnectSocket = () => {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
};

