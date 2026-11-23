# StrangerConnect — Omegle-style Chat

A runnable development starter for anonymous random text/video chat.

## Requirements
- Node.js 20 LTS or newer
- npm
- VS Code

## Run locally
1. Extract the ZIP and open the `Omegle-Ready` folder in VS Code.
2. Open Terminal in VS Code.
3. Install dependencies:
   ```bash
   npm install
   npm run install:all
   ```
4. Copy `server/.env.example` to `server/.env`.
5. Start both apps:
   ```bash
   npm run dev
   ```
6. Open `http://localhost:5173` in two browser tabs (or two devices on the same LAN using your PC's LAN IP and configure the server URL in `client/.env`).

The API/socket server runs on `http://localhost:8000`.

## Features
- Random video and text matching
- Optional comma-separated interests
- Next/skip, disconnect, online count
- Camera/microphone controls
- WebRTC with public STUN servers
- Report event endpoint/socket event and local block list
- Input validation, message length limits, basic rate limits and CORS configuration

## Important deployment notes
This is a development-ready MVP, not a production audited service. WebRTC works best with HTTPS. For reliable calls across restrictive networks, configure a TURN server and set `ICE_SERVERS` in `server/.env`. Never expose TURN credentials in public source control. Set `CLIENT_ORIGIN` to your deployed frontend URL. Add persistent moderation review, abuse prevention, age/safety controls, monitoring and a durable database before opening to the public.

The current block list is kept in the browser; reports are emitted to the server console and are not yet a staffed moderation workflow. The online count is in-memory and resets when the server restarts. No login/database is required for anonymous matching.
