# Doodle Duel

**Play:** https://doodle.sagar-gavand.co.in

A mobile-first multiplayer draw-and-guess party game. One player draws, everyone else races to guess the word in chat.

## Features
- **Phone-first:** pinch to zoom and pan the canvas, smoothed strokes, a one-row toolbar with a colour/brush bottom sheet, chat that shrinks the canvas when the keyboard opens, big flashes and vibration for "close" and "correct" guesses.
- **Drawing tools:** pen, bucket fill, line/rectangle/ellipse, eraser, 4 brush sizes, 21 preset colours plus a custom colour picker, undo, clear.
- **Room settings:** rounds, draw time, number of word choices, max players, word packs (General, Food, Movies & TV, India, Hinglish), difficulty (easy ×1, medium ×1.25, hard ×1.5 points), custom words (optionally the only words used), public or private room.
- **Social:** emoji avatars with colours, emoji reactions over the canvas, vote to skip a drawing, vote to kick (the host can remove directly), rate each drawing (+10 to the drawer per 👍), sound effects with mute.
- **End screen:** podium, confetti and a gallery of every drawing (tap one to save or share it).
- **Reliability:** rejoin your seat after a refresh or a phone sleeping; if the host leaves, the next player takes over the room automatically with scores and settings intact.
- **Sharing:** invite sheet with a QR code, share and copy buttons; installable as an app (PWA).
- **Public rooms:** "Browse public rooms" lists open public rooms. There's no backend: the first public host also keeps the room list.

## How it works
No game server. Players connect peer-to-peer over WebRTC, using the PeerJS public broker for signalling. The room creator's browser runs the game. Every client keeps a snapshot of the game so another player can take over.

Connections use STUN only, so a few strict networks (some mobile carriers or office Wi-Fi) may not connect. A TURN relay fixes that but needs a provider account; add its servers to `ICE` in `app.js`.

## Files
`index.html` (markup), `style.css`, `app.js` (game engine), `words.js` (word packs), `sw.js` + `manifest.json` (PWA), `vercel.json` (security headers). A static site deployed on Vercel.
