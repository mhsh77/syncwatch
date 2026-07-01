import { io } from "socket.io-client";

const SERVER_URL = "http://109.122.250.39:3001";

let socket = null;

export function connect() {
  if (socket) return socket;
  socket = io(SERVER_URL, { transports: ["websocket"] });
  return socket;
}

export function getSocket() {
  return socket;
}

export function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
