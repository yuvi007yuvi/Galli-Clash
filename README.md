# Galli Clash

A browser street-fighting game set in an Indian galli. Fight a friend on the same keyboard, or online from different devices using a room code.

**Play:** https://yuvi007yuvi.github.io/Galli-Clash/

## Play online with a friend
1. One player taps **Create Online Room** and gets a 5-character code.
2. Share the code (or tap **Share Link** to send a link that joins directly).
3. The friend types the code and taps **Join Room**. The fight starts as soon as you connect.

The room creator plays **Raju** (orange), the friend plays **Bunty** (green). Best of 3 rounds, 60 seconds each. Either player can start a rematch.

## Controls
| Action | Keyboard (online / P1) | P2 on same keyboard | Phone |
|---|---|---|---|
| Move | `A` `D` (online: arrows also work) | `←` `→` | ◀ ▶ |
| Jump | `W` | `↑` | ▲ |
| Block | `S` (hold) | `↓` | BLOCK |
| Punch | `F` | `,` | 👊 |
| Kick | `G` | `.` | 🦵 |
| Chappal throw | `H` (3s cooldown) | `/` | CHAPPAL |

## How online play works
Online mode uses [PeerJS](https://peerjs.com/) (WebRTC). The room creator's browser runs the fight and streams it to the friend, who sends back button presses. There is no game server to run; the free PeerJS cloud only introduces the two devices.

If two phones on mobile data can't connect, try with at least one on Wi-Fi. Some mobile networks block direct peer-to-peer links; fixing that fully needs a TURN server, which can be added to the `ICE` list at the top of `game.js`.

## Run locally
Any static server works:
```
python3 -m http.server 8000
```
Then open http://localhost:8000.

## Files
- `index.html`: page and menus
- `style.css`: layout and touch buttons
- `game.js`: game logic, drawing, sound, input and networking
