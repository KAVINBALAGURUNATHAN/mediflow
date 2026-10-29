/**
 * services/socket.js
 * Exports a single Socket.IO client instance shared across the app.
 * Using a singleton means we never open duplicate WebSocket connections.
 */

import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

// Never stops trying.
//
// This used to give up after 5 attempts at 1 second apart - so roughly five
// seconds of backend downtime permanently killed live updates, and the only
// cure was for somebody to reload the page. That is wrong for every screen
// this app has, and badly wrong for the waiting-room display, which hangs on
// a wall unattended all day: a backend restart (a deploy, or a free-tier
// instance spinning back up, which takes far longer than five seconds) left
// it showing a stale queue with a small "Live updates unavailable" badge that
// nobody is standing next to.
//
// Backoff is capped so a long outage does not turn into a slow reconnect once
// the server is back, and randomizationFactor spreads the retries out so
// every display in the building does not hammer the API in lockstep.
const socket = io(SOCKET_URL, {
  autoConnect: true,
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  randomizationFactor: 0.5,
  transports: ['websocket', 'polling'],
});

export default socket;
