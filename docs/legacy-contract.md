# Legacy Contract

Reference for the FastAPI + React app this rebuild replaces. Source of truth is
`backend/main.py` (425 lines) and `frontend/src/`.

The legacy code is **read-only reference**. It stays at `backend/` and `frontend/`
until the rebuild is verified, then both directories are deleted. Do not modify
it and do not import from it.

---

## 1. Transport summary

| | Legacy | Rebuild |
|---|---|---|
| Realtime | Raw WebSocket, `GET /ws/chat?token=<uuid>` | Socket.IO, default namespace |
| Auth | Bearer token in a query string, minted by a REST call | Opaque token in `localStorage`, passed in the Socket.IO handshake |
| State | Free-form module-level `dict` and `set` | Explicit state machine, `idle → queued → chatting → ended` |

Legacy uses plain WebSocket, so there are no rooms, no acks, and no server-side
event namespacing. Every message is `{ "event": "...", ... }` JSON with a string
discriminator.

---

## 2. HTTP endpoints

| Method | Path | Auth | Request | Response |
|---|---|---|---|---|
| POST | `/login` | **none** | `?email=<addr>` | `{ token, email }` |
| POST | `/google-login` | Google ID token | `{ token }` | `{ success, token?, email?, message? }` |
| GET | `/online` | optional `?token=` | — | `{ online, details: { active_connections, logged_in } }` |
| GET | `/download/{chat_id}` | `?token=` must be in the chat | — | `{ chat_id, messages }` |

### `/login` is not a gate

```python
if not email.endswith(ALLOWED_EMAIL_DOMAIN):
    raise HTTPException(status_code=400, detail="Invalid email domain")
token = str(uuid.uuid4())
```

Any caller who can type an `@marwadiuniversity.ac.in` address gets a valid token.
No password, no email verification, no session expiry. It is a UI convenience,
not a security control. The rebuild uses verified Google OAuth instead.

---

## 3. WebSocket events

### Client → server

| Event | Payload | Server behaviour |
|---|---|---|
| `connect_to_chat` | — | Joins `ready_users`, scans for a partner, either pairs or queues |
| `message` | `{ message: string }` | Looks up the sender's chat by scanning **every** active chat, appends to history, forwards to peer |
| `typing` | — | Records `typing_status[token] = { timestamp, peer_token }`, notifies peer |

### Server → client

| Event | Payload | When |
|---|---|---|
| `waiting` | `{ message: "Waiting for a chat partner..." }` | No partner available |
| `chat_started` | `{ chat_id, peer: <email> }` | Both parties matched |
| `message` | `{ message, sender: <email> }` | Peer sent a message |
| `typing` | `{ message: "<email> is typing..." }` | Peer is typing |
| `typing_ended` | — | Typing expired (3s) or peer sent a message |
| `chat_ended` | `{ message: "User <email> disconnected" }` | Peer disconnected |
| `error` | `{ message }` | Unknown event, no chat session, or no partner |

### Legacy vs rebuild contract

The rebuild keeps the same *behaviour* but renames every event and drops the
email from every payload:

| Legacy | Rebuild |
|---|---|
| `connect_to_chat` | `queue:join` |
| — (close socket) | `queue:leave` |
| `message` `{message}` | `chat:message` `{text}` |
| `typing` | `chat:typing` `{isTyping}` |
| — | `chat:skip` |
| — | `chat:leave` |
| `waiting` | `queue:waiting` |
| `chat_started` | `match:found` `{roomId}` |
| `message` | `chat:message` `{id, text, from, ts}` |
| `typing` / `typing_ended` | `chat:typing` `{isTyping}` |
| `chat_ended` | `chat:partner_left` |
| — | `presence:count` `{online}` |
| `error` | `error` `{code, message}` |

`chat:skip` has no legacy equivalent. Legacy's "Find New Partner" button just
closes the socket and opens a new one, which orphans the partner until their
socket notices the drop. Skip is the main behavioural upgrade in this rebuild.

---

## 4. How matching works

Two parallel module-level lists, both append-ordered:

```python
ready_users: List[str] = []     # clicked "Connect to Chat"
waiting_queue: List[str] = []   # actively waiting for a partner
```

On `connect_to_chat`:

1. Append self to `ready_users` if not present.
2. Scan `ready_users` **from the head**, take the first token that is not self
   *and* is also in `waiting_queue`.
3. **If found:** create `chat_id`, append self to `waiting_queue`, create the
   chat, emit `chat_started` to both, then remove both tokens from
   `ready_users` and `waiting_queue`.
4. **If not found:** append self to `waiting_queue`, emit `waiting`.

Properties that carry over:

- **Pairing is newcomer-driven.** Only the arriving user scans. Two people who
  are both already waiting never re-trigger a scan — but they would already have
  been paired, so it works out.
- **Roughly FIFO.** Because the scan starts at the head of `ready_users`, the
  longest-waiting eligible user wins. It is not strict FIFO: a token in
  `ready_users` but not yet in `waiting_queue` is silently skipped over.

Properties the rebuild fixes:

- **Self-match is possible.** Everything is keyed by `token`, not by socket. One
  account open in two tabs produces two tokens-as-"different-users" that can be
  matched to each other. The rebuild keys everything by `socket.id`.
- **No state machine.** Nothing prevents `connect_to_chat` while already
  matched, which re-adds you to the queue while you still hold an active chat.

---

## 5. Edge cases handled

- Disconnect while queued → `manager.disconnect` removes the token from
  `ready_users`, `waiting_queue`, `typing_status`.
- Disconnect while chatting → peer receives `chat_ended`, the chat is deleted.
- Unknown event → `error` to sender, loop continues.
- `message` with no active chat → `error: "Chat session not started"`.
- `message` in a chat with no peer → `error: "No chat partner found"`.
- `typing` while not in a chat → silently ignored (no `user_chat_id`, no branch).

---

## 6. Edge cases wrong or missing

### Security and privacy

- **Peer emails leak on the wire.** `chat_started.peer`, `message.sender`,
  `typing.message` and `chat_ended.message` all carry the other party's email
  address. The frontend redacts them for display; the socket payload does not.
  Anyone with devtools sees them. The rebuild never puts identity on the wire
  at all.
- **`/login` is bypassable**, see section 2.
- **Token in the query string** → written to access logs and proxy logs.
- **CORS `allow_origins=["*"]` with `allow_credentials=True`** — an invalid and
  unsafe combination.
- **No origin check** on the WebSocket upgrade.
- FastAPI pinned at `0.95.1` (2022).

### Correctness

- **Two tabs, one token.** `manager.connect` does
  `active_connections[token] = websocket`, silently overwriting the first
  socket. The orphaned socket stays open and its chat is now unreachable. When
  the *new* socket later disconnects, the shared chat is destroyed out from
  under both.
- **Unbounded memory.** `active_chats` holds every message from every chat for
  the process lifetime. Never evicted, never TTL'd. `/download/{chat_id}` will
  happily return a conversation from hours ago to anyone still in the pair.
- **O(chats) message routing.** Finding "my" chat scans every entry in
  `active_chats` on every single message.
- **No rate limit.** Unlimited messages per second per socket.
- **No length cap.** A single huge message is stored and forwarded as-is.
- **Typing indicator self-cancels.** `handle_typing_expiration` clears
  `typing_status` 3s after the last keystroke, dropping the indicator mid-word.
  There is no way for the client to keep it alive.
- **`online` is a union of two unrelated sets.** A user who called `/login` but
  never opened a WebSocket is counted forever, because `online_users` is only
  cleaned up in `disconnect`.

### Frontend

- `alert()` used to display the online count.
- `fetchOnlineUsers` passes the token as a query parameter.
- The online count on the landing page is **hardcoded** — `+80 users online now`,
  plus four fabricated avatar initials.
- Chat history is stored in React state, so **Skip/refresh loses it**.
- No reconnect handling. The socket is closed and reopened by hand on
  "Find New Partner" only.

---

## 7. Keep, drop, change

### Keep the behaviour

FIFO queueing, match-found, two-way message relay, typing indicator,
partner-left notification, online count.

### Keep and fix

| Feature | Legacy problem | Rebuild |
|---|---|---|
| Campus access | `/login` unverified | Verified Google OAuth, domain allowlist from env |
| Match | keyed by token, self-match possible | keyed by `socket.id` |
| Presence | union of two sets, never decrements | refcounted per identity, pushed on connect/disconnect |
| Typing | server cancels it after 3s | client-driven `chat:typing {isTyping}` |

### Drop

| Feature | Reason |
|---|---|
| `/login` email-only | Not a gate; superseded by verified OAuth |
| `GET /download/{chat_id}` | Requires unbounded server-side history, which contradicts the no-database MVP |
| Download-as-PDF (jsPDF) | Same reason; would need history retention to be useful |
| React Router auth redirects | Gate is a single pre-flight session call, no routes needed |
| Marketing landing page | Hardcoded fake stats and testimonials; MVP landing is Start + online count |
| `axios` | Socket.IO carries everything; one REST call for the session token |

### Known regression

Dropping PDF export means users can no longer save a conversation. Accepted as
MVP scope.