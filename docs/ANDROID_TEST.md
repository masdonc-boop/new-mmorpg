# First controlled multiplayer test on two Android phones

This is how to run Brightwater's multiplayer server on **your own computer** and play on two Android phones. It is a private test:
- nothing is bought, hosted or published;
- the server is reachable only by the phones you choose;
- it stops when you close it.

(The preview link on claude.ai is the single-player game only. A page served over https can't connect to a test server on your home network, so for multiplayer the phones open the game from your computer.)

## What you need

- A computer (Windows, macOS or Linux) with:
  - **Node.js 22 LTS** (nodejs.org);
  - **git**;
  - the Brightwater repository: `git clone https://github.com/masdonc-boop/new-mmorpg.git`, then `git checkout claude/fantasy-mmorpg-phase-1-m93ev0`.
- Two Android phones with **Chrome**.
- Either:
  - **USB cables** (option A, the most private), or
  - the phones and the computer on the **same Wi-Fi** (option B), or
  - **Tailscale** installed on all three (option C).

## Choosing how the phones reach the computer

| Option | Who can reach the server | Cost | Setup |
|---|---|---|---|
| **A. USB cable** (`adb reverse`), recommended | Only phones plugged into the computer. The server listens on the computer itself and is on no network at all. | Free | Developer options and USB debugging on each phone; Android platform-tools on the computer |
| **B. Same Wi-Fi** | Devices on your home network that know the address. Plus an invite code for new accounts and only your game page allowed. | Free | Your computer's local address; allow it through the firewall on private networks only |
| **C. Tailscale** (private network) | Only devices signed in to your own Tailscale account, wherever they are | Free personal plan | Install Tailscale on the computer and both phones, signed in to the same account |
| ~~Public tunnels~~ (ngrok, Cloudflare quick tunnels…) | Anyone on the internet with the link | — | **Not used.** They would make the server public. They need your explicit decision first. |

The server enforces this:
- By default it listens on the computer only.
- It refuses to listen anywhere else unless an **invite code** (at least 8 characters) and the **allowed game page** are set.
- Guest play (no password) is never allowed beyond the computer.
- The live Exchange is **off** unless you start the server with `LIVE_EXCHANGE=1`. Leave it off for this first test.

## Step by step

### 1. Prepare the computer (once)

```
cd new-mmorpg
npm ci
npm run build
```

Give yourself the admin role for moderation. Do this after you have created your account in step 3. It can run while the server is running.
```
npm run admin -- grant YourName admin
```

### 2A. Option A: USB cables (recommended)

On the computer, in two terminals:

```
npm run server
```

```
npx vite preview --port 4173 --strictPort
```

On each phone:
1. Settings → About phone → tap **Build number** seven times.
2. Settings → System → Developer options → turn on **USB debugging**.
3. Plug the phone in and accept the "Allow USB debugging?" prompt.

On the computer, install Android **platform-tools** (developer.android.com/tools/releases/platform-tools, free). Then:

```
adb devices
```

Both phones should be listed, each with a serial such as `R58N12ABCDE`. Then, for **each** serial:

```
adb -s <serial> reverse tcp:4173 tcp:4173
adb -s <serial> reverse tcp:8787 tcp:8787
```

On each phone, open Chrome at:

```
http://localhost:4173/?server=ws://localhost:8787
```

### 2B. Option B: same Wi-Fi

1. Find the computer's local address:
   - Windows: `ipconfig` (IPv4 Address);
   - macOS: `ipconfig getifaddr en0`;
   - Linux: `hostname -I`.
   
   The examples below use `192.168.1.20`.
2. Pick an invite code, for example `river-otter-42`. Tell it only to your tester.
3. Start the server.

   macOS or Linux:
   ```
   HOST=192.168.1.20 INVITE_CODE=river-otter-42 ALLOWED_ORIGINS=http://192.168.1.20:4173 npm run server
   ```
   Windows PowerShell:
   ```
   $env:HOST="192.168.1.20"; $env:INVITE_CODE="river-otter-42"; $env:ALLOWED_ORIGINS="http://192.168.1.20:4173"; npm run server
   ```
4. Serve the game page in a second terminal:
   ```
   npx vite preview --host 192.168.1.20 --port 4173 --strictPort
   ```
5. If the computer's firewall asks, allow Node **on private networks only**.
6. Don't set up port forwarding on the router: that is what would make it public.
7. On each phone (on the same Wi-Fi, not a guest network, which often keeps devices apart), open:
   ```
   http://192.168.1.20:4173/?server=ws://192.168.1.20:8787
   ```
8. Enter the invite code when creating an account.

### 2C. Option C: Tailscale

Same as option B, using the computer's Tailscale address (100.x.y.z, shown in the Tailscale app) in place of `192.168.1.20`. Only devices signed in to your Tailscale account can reach it, even away from home.

### 3. Create the accounts

On each phone:
1. Enter a name (3 to 12 letters or numbers) and a password (at least 8 characters).
2. Enter the invite code if you used option B or C.
3. Tap **Create account** and choose the character's looks.

Each tester uses their own account.

### 4. The test (about 20 minutes)

Tick each item as you go and note anything odd, with the time:

1. **See each other.** Both walk around the village. Each sees the other's character, name and gear move smoothly.
2. **Chat.** Tap 💬, say hello (it shows over your head and in the other's log). Whisper with `@TheirName hi`.
3. **Trade.** Tap the other player and choose Trade; the other taps Trade on the card.
   - Offer bread or coins on both sides, Accept, then Confirm on the final screen.
   - Check both bags changed.
   - Do it again, and Decline once.
4. **Share the world.**
   - Both chop the same tree or mine the same rock until it runs out: both see it go.
   - Fight the same goblin together: both see the hits.
5. **Houses.** One walks into the house by the Exchange plaza: they vanish for the other (each house is private). Walk out again.
6. **Glimmer Hollow** (optional, needs a glowcap lantern). Go down; the other stays up.
7. **Connection drops.**
   - On one phone, turn on aeroplane mode for 10 seconds, then off. The game should say "Reconnected." and carry on.
   - Lock one phone for a minute, then come back.
8. **Same account twice.** Sign in to your account in a second Chrome tab. The first tab should say "Signed in from somewhere else", and there must be only one of you in the world.
9. **Moderation** (as the admin from step 1). In chat, try:
   - `/who`;
   - `/mute OtherName 1 test`, then `/unmute OtherName`;
   - `/reports` after the other player reports you from the player menu.
10. **Eastreach** (optional, Phase 4A). Walk east from the village along the Ironcrag road to the signpost and over the Saltwind Causeway together.
    - At the fork, one goes north to Cairnhold and the other south to Heronwick.
    - Each should see the other leave and come back into view.
    - Note the frame rate in each settlement (Settings → Show FPS).
11. **Dungeons** (optional, Phase 4C/4D, needs a character that meets the requirements).
    - Open the game with `&perf` added to the address to see the frame rate and draw calls.
    - Tap the Old Watchtower's door, both stairs, the chest after the boss, and the way out.
    - In the Sunken Shrine sanctum, tap the Shrinekeeper's nameplate while its guardians crowd round.
    - Note the fps and the worst frame time during each boss fight, and whether the dim rooms are readable.
12. **Progression and gear** (Phase 5A).
    - Press and hold a weapon or a piece of armour in the bag: the card should show its stats, its pace and reach (weapons), what it needs, and how it compares with what you wear.
    - Open the bag's equipment box: under the slots it shows your max hit, how often you attack, and your reach.
    - Wear a cape, gloves or bracers, boots and an amulet: each should show on your hero, and on your hero as seen from the other phone.
    - Gain a level (for example by chopping a few trees): the banner and the message log should say what the level opens.
    - Open Skills and scroll to the bottom: the combat level line should name the quickest ways to the next combat level.
13. **Combat training and armour** (Phase 5B).
    - Tap the 🎯 chip on the combat button and pick Attack, Strength, Defence or Balanced. The chip should show your choice. Fight a few creatures and check that only that skill (and Hitpoints) gains xp.
    - In the bag, press and hold a breastplate, a hide coat and a robe. Each card should show armour against melee, ranged and magic, and how it compares with what you wear.
    - Wear metal armour and fight goblins: some misses should read "blocked".
    - Make a pair of sabatons or handguards at the anvil (or hide boots or mireweave gloves with a needle) and wear them. They should show on the hero.
14. **Loot and the collection log** (Phase 5C).
    - Fight goblins, wolves or boars for a while. Ordinary drops look as before. Uncommon piles show a green name and rare ones a gold, pulsing name, with one "Rare drop!" label.
    - Pick up an uncommon or rare item: the toast should say "Uncommon" or "Rare" in its colour.
    - A first rare gear drop should say "New log entry". Open Quests: the Creature finds card should show it in colour.
    - Close the game fully, reopen it, and check the entry is still there.
    - With a full bag, the rare pile should stay on the ground, marked.
15. **Creature fights** (Phase 5D).
    - Fight Grukk in the Goblin Encampment. A red ring with an orange band should mark the ground, with "⚠ Club slam" above him. Walk out with the joystick before the band reaches the edge: you should see "dodged!" and take no damage. Stay in once to see the bigger hit.
    - Tap to attack Grukk while a ring is showing: the hero should wait at the ring's edge, not walk in.
    - Attack a wolf near another: one more wolf should join. Bring a goblin low: it should break off and call a friend.
    - In Mirefen, let a mire leech hit you: "slowed" and a "🐌 Slowed" chip under your health. Walking should be slower for 3 seconds.
    - In Thornridge, find the Ironhide Bristleback (gold ★ name) and dodge its charge.
    - On two phones, stand in a boss's ring together, then have one step out: only the one who stayed is hit.
16. **Server restart.** Stop the server (Ctrl+C) and start it again with the same command. Both phones should reconnect by themselves within a few seconds, with everything as it was.

### 5. Afterwards

- **Stop the servers:** Ctrl+C in both terminals.
- **USB option:** run `adb reverse --remove-all` for each phone and turn off USB debugging if you like.
- **Wi-Fi option:** remove the firewall permission if you added one.
- **What to send back:**
  - the server terminal's log (it shows sign-ins, trades and any errors);
  - `npm run admin -- audit` and `npm run admin -- flags`;
  - the phone models with their Android and Chrome versions;
  - your notes from step 4.
- **The data** stays in `server/data/dev.sqlite` on your computer. Delete the `server/data` folder to start fresh.

## If something goes wrong

| What you see | What to try |
|---|---|
| "Could not reach the server" | Check the server terminal is running and the address in the link matches. **USB:** run the two `adb reverse` lines again (they reset when the cable is unplugged). **Wi-Fi:** use the same network, not a guest one; allow the firewall prompt. |
| "This game version doesn't match the server" | Run `npm run build` again, restart both terminals and reload the page. |
| "This server needs an invite code" | Type the code from step 2B into "Invite code" when creating the account. |
| The server refuses to start with a message about HOST | Option B or C needs `INVITE_CODE` and `ALLOWED_ORIGINS` (step 2B). |
| A phone was connected to the old page | Close the tab and open the link again (old builds can't join a newer server). |
EOF
echo done