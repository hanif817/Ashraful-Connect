# Ashraful Connect — OmeTV-style Anonymous Chat

A guest-only random video/text chat starter built with Vite, Node.js, Express, Socket.IO and WebRTC. No account or login is required.

## Requirements
- Node.js 20 or newer
- npm
- VS Code

## Local setup
1. Extract the ZIP and open the `Omegle-Ready` folder in VS Code.
2. Open a terminal in that folder.
3. Install packages:
   ```bash
   npm install
   npm run install:all
   ```
4. Copy `server/.env.example` to `server/.env`.
5. Copy `client/.env.example` to `client/.env`.
6. Run both apps:
   ```bash
   npm run dev
   ```
7. Open `http://localhost:5173` in two separate browser windows to test matching.

Backend health endpoint: `http://localhost:8000/api/health`

## Production deployment

### Backend (Render)
- Repository root: project root
- Root Directory: `server`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variable `CLIENT_ORIGIN`: comma-separated exact frontend origins, for example `https://your-domain.example`
- Do not set `PORT`; Render supplies it.
- Keep any TURN credentials private. Add `ICE_SERVERS` only if you have a TURN/STUN configuration.

### Frontend (InfinityFree)
1. In `client/.env`, set:
   ```env
   VITE_SERVER_URL=https://your-render-service.onrender.com
   ```
2. From the project root, run:
   ```bash
   npm run build
   ```
3. Upload the *contents* of `client/dist/` into InfinityFree `htdocs/`:
   - `index.html`
   - `assets/` folder
4. Make sure the site uses HTTPS. Web camera and microphone access require a secure context.
5. Update Render `CLIENT_ORIGIN` to the exact HTTPS InfinityFree origin, then redeploy the backend.

## Matching behavior
- Video and text chat queues are separate.
- Country selection groups users who choose the same country; “Any country” can match with any country group.
- Optional interests are supported by the backend API. The current UI leaves interests empty for a simple OmeTV-style experience.
- Next disconnects the current pair and searches again.
- Block applies only to the current socket session; it is not persistent.
- Reports are logged to the server console; there is no staffed moderation dashboard or persistent report database yet.

## Important limitations before public launch
- This is an MVP, not a production-audited service.
- The online count and queues are in memory and reset when the server restarts. A single Render instance is assumed.
- Public STUN servers do not guarantee calls across restrictive NATs. Reliable production video calls usually require a TURN service; configure it privately in `ICE_SERVERS`.
- Guest mode has no verified age or identity. Add robust age assurance, moderation, abuse prevention, privacy/legal pages, monitoring, and persistent storage before public launch.
- Render free instances may sleep when idle. The first request after sleep can be delayed.
- InfinityFree hosts the static frontend only; it does not run the Node.js backend or Socket.IO server.

### Matching filters note
The Country selector is used by the current in-memory matcher. The visible “I am” selector is a presentation placeholder only in this starter; it does not filter partners. Do not advertise gender matching until it is implemented with privacy, abuse-prevention, and age-safety controls.


## Reference-matched UI update
The client now uses the approved cream/white OmeTV-inspired layout with paired video panels, green Next (which starts the first chat and advances to the next stranger while active), orange Stop, white selectors, and a compact safety/chat panel. Button hover and press states are CSS-driven and preserve the existing socket/WebRTC handlers.
