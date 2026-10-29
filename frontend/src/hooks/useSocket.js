/**
 * hooks/useSocket.js
 * Subscribes to a Socket.IO event and calls the handler whenever
 * the event fires. Automatically cleans up on unmount.
 *
 * Usage:
 *   useSocket('queueUpdated', (data) => setQueue(data));
 */

import { useEffect } from 'react';
import socket from '../services/socket';

const useSocket = (eventName, handler) => {
  useEffect(() => {
    socket.on(eventName, handler);
    return () => {
      socket.off(eventName, handler);
    };
  }, [eventName, handler]);
};

export default useSocket;
