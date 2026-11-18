# Galli Clash ⚔️

Street fighter of the galli. 9 fighters, 27 supers, weapon grab combos, arcade mode, CPU, same-device 2 player, training, and **online play with a friend on another device**.

**Play:** https://yuvi007yuvi.github.io/Galli-Clash/

## Play online with a friend
1. Pick **🌐 ONLINE**, choose your fighter, and tap **Next: Create / Join Room**.
2. One player taps **Create Room** and shares the 5-letter code, or taps **Share Link** to send a link that joins directly.
3. The friend picks their fighter, types the code, and taps **Join Room**. The fight starts as soon as you connect.

The room creator fights on the left; the friend fights on the right. A **YOU** arrow marks your fighter. Either player can ask for a rematch.

## Controls
**Keyboard:** A/D move · W jump · S roll · hold back (or L) block · J punch · K kick · U grab · O special · I super. Online, the arrow keys also move.
**Phone:** joystick + on-screen buttons.

## How online works
Online play uses [PeerJS](https://peerjs.com/) (WebRTC). The room creator's device runs the fight and streams it to the friend, whose button presses are sent back. No game server needed; the free PeerJS cloud only introduces the two devices.

- If two phones on mobile data can't connect, try with at least one on Wi-Fi. Some mobile networks block direct connections (fixing that fully needs a TURN server in `NET_ICE`).
- Keep the game open on the room creator's screen; if that tab goes to the background the fight pauses for both.

## Run locally
```
python3 -m http.server 8000
```
Then open http://localhost:8000.
