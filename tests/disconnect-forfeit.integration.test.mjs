import { io } from 'socket.io-client';

const API = 'http://localhost:4000';

async function signIn(email, password) {
  const res = await fetch(`${API}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  return res.json();
}

async function main() {
  const white = await signIn('cedarknight@example.com', 'password123');
  const black = await signIn('brasspawn@example.com', 'password123');

  let whiteSocket = io(API, { auth: { token: white.token }, reconnection: false });
  const blackSocket = io(API, { auth: { token: black.token }, reconnection: false });
  await Promise.all([
    new Promise(r => whiteSocket.on('connect', r)),
    new Promise(r => blackSocket.on('connect', r))
  ]);

  // Set up an active match between them via REST
  const createRes = await fetch(`${API}/challenges`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${white.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponentName: 'BrassPawn', stake: 5 })
  });
  const created = await createRes.json();
  const acceptRes = await fetch(`${API}/challenges/${created.id}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${black.token}` }
  });
  const accepted = await acceptRes.json();
  console.log('Match started:', accepted.matchId);

  // --- Test: white disconnects -> black should get opponent:disconnected ---
  const disconnectedPromise = new Promise(resolve => {
    blackSocket.on('opponent:disconnected', payload => {
      console.log('TEST PASS: black notified of white disconnecting ->', payload);
      resolve(payload);
    });
    setTimeout(() => resolve(null), 3000);
  });
  whiteSocket.close();
  const disconnectEvent = await disconnectedPromise;
  if (!disconnectEvent) console.log('TEST FAIL: no opponent:disconnected event received');

  // --- Test: white reconnects -> black should get opponent:reconnected ---
  const reconnectedPromise = new Promise(resolve => {
    blackSocket.on('opponent:reconnected', payload => {
      console.log('TEST PASS: black notified of white reconnecting ->', payload);
      resolve(payload);
    });
    setTimeout(() => resolve(null), 3000);
  });
  whiteSocket = io(API, { auth: { token: white.token }, reconnection: false });
  await new Promise(r => whiteSocket.on('connect', r));
  const reconnectEvent = await reconnectedPromise;
  if (!reconnectEvent) console.log('TEST FAIL: no opponent:reconnected event received');

  whiteSocket.close();
  blackSocket.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
