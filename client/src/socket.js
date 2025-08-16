// client/src/socket.js
import { io } from 'socket.io-client';
import { getToken } from './utils/auth'; // you already have getToken

const URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000';

let socket;

export function getSocket() {
  if (!socket) {
    const token = getToken();
    socket = io(URL, {
      auth: { token },               // send token in handshake
      transports: ['websocket'],
      reconnectionAttempts: 5,
    });
  }
  return socket;
}

// used when login/logout to update token
export function refreshSocketAuth() {
  const token = getToken();
  if (socket && socket.auth) {
    socket.auth = { token };
    if (!socket.connected) socket.connect();
    else {
      // Force reconnect to re-authenticate with the new token
      socket.disconnect();
      socket.connect();
    }
  }
}

