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
  const black = await signIn('rookmother@example.com', 'password123');
  console.log('Signed in:', white.name, black.name);

  // --- Test 1: connection without a token should be rejected ---
  await new Promise(resolve => {
    const badSocket = io(API, { auth: {}, reconnection: false });
    badSocket.on('connect_error', err => {
      console.log('TEST 1 PASS: unauthenticated connection rejected ->', err.message);
      badSocket.close();
      resolve();
    });
    badSocket.on('connect', () => {
      console.log('TEST 1 FAIL: unauthenticated connection was accepted!');
      badSocket.close();
      resolve();
    });
    setTimeout(resolve, 3000);
  });

  // --- Test 2: connection with a valid token should succeed ---
  const whiteSocket = io(API, { auth: { token: white.token }, reconnection: false });
  const blackSocket = io(API, { auth: { token: black.token }, reconnection: false });

  await Promise.all([
    new Promise(resolve => whiteSocket.on('connect', () => { console.log('TEST 2a PASS: white socket connected'); resolve(); })),
    new Promise(resolve => blackSocket.on('connect', () => { console.log('TEST 2b PASS: black socket connected'); resolve(); }))
  ]);

  // --- Test 3: lobby should now show both as online ---
  await new Promise(r => setTimeout(r, 300));
  const lobbyRes = await fetch(`${API}/lobby/players`, { headers: { Authorization: `Bearer ${white.token}` } });
  const lobby = await lobbyRes.json();
  const namesInLobby = lobby.map(p => p.name);
  console.log('TEST 3:', namesInLobby.includes('RookMother') ? 'PASS' : 'FAIL', '- lobby shows:', namesInLobby);

  // --- Test 4: real-time challenge:incoming push ---
  const incomingPromise = new Promise(resolve => {
    blackSocket.on('challenge:incoming', payload => {
      console.log('TEST 4 PASS: black received challenge:incoming ->', payload);
      resolve(payload);
    });
    setTimeout(() => resolve(null), 3000);
  });
  const createRes = await fetch(`${API}/challenges`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${white.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ opponentName: 'RookMother', stake: 15 })
  });
  const created = await createRes.json();
  const incoming = await incomingPromise;
  if (!incoming) console.log('TEST 4 FAIL: no challenge:incoming event received');

  // --- Test 5: real-time challenge:accepted push back to creator ---
  const acceptedPromise = new Promise(resolve => {
    whiteSocket.on('challenge:accepted', payload => {
      console.log('TEST 5 PASS: white received challenge:accepted ->', payload);
      resolve(payload);
    });
    setTimeout(() => resolve(null), 3000);
  });
  const acceptRes = await fetch(`${API}/challenges/${created.id}/accept`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${black.token}` }
  });
  const accepted = await acceptRes.json();
  const acceptedEvent = await acceptedPromise;
  if (!acceptedEvent) console.log('TEST 5 FAIL: no challenge:accepted event received');

  // --- Test 6: real-time match:move relay over the socket itself (not REST) ---
  const movePromise = new Promise(resolve => {
    blackSocket.on('match:move', payload => {
      console.log('TEST 6 PASS: black received match:move over socket ->', payload);
      resolve(payload);
    });
    setTimeout(() => resolve(null), 3000);
  });
  whiteSocket.emit('match:move', { matchId: accepted.matchId, san: 'e4' });
  const moveEvent = await movePromise;
  if (!moveEvent) console.log('TEST 6 FAIL: no match:move event received over socket');

  whiteSocket.close();
  blackSocket.close();
  process.exit(0);
}

main().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
