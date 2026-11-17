"use strict";
/* Doodle Duel — peer-to-peer draw & guess. The room creator's browser is the authority ("host").
   Every client keeps a snapshot so another player can take over if the host drops. */
const $ = id => document.getElementById(id);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PREFIX = "doodleduel-", LOBBY_ID = "doodleduel-lobby-v1";
// STUN only for now. A TURN relay (for strict mobile/office networks) needs an account with a provider;
// add its servers here (or serve short-lived credentials from an API route) when available.
const ICE = { config: { iceServers: [
  { urls: ["stun:stun.l.google.com:19302", "stun:stun.cloudflare.com:3478"] },
] } };
const AVATARS = ["🐱","🐶","🦊","🐼","🐸","🐵","🦁","🐯","🐨","🐰","🐙","🦄","🐧","🐢","🦖","👽","🤖","👻","🎃","🍕","🌵","⭐","🚀","🎸"];
const AVCOLS = ["#fde68a","#fecaca","#bbf7d0","#bfdbfe","#ddd6fe","#fbcfe8","#fed7aa","#a5f3fc"];
const COLORS = ["#111111","#ffffff","#9ca3af","#4b5563","#ef4444","#f97316","#facc15","#84cc16","#22c55e","#14b8a6","#06b6d4","#3b82f6","#6366f1","#a855f7","#ec4899","#f43f5e","#92400e","#d97706","#fcd5b5","#7f1d1d","#064e3b"];
const SIZES = [3, 8, 16, 30];
const EMOJIS = ["👍","😂","🔥","😮","🤔","👎"];
const DEFAULTS = { rounds: 3, time: 80, choices: 3, max: 10, pack: "general", diff: "mixed", custom: "", onlyCustom: false, public: false };
const PICK_S = 15, REVEAL_S = 7;

// ---------- storage ----------
const store = {
  get(k, d, s) { try { const v = (s ? sessionStorage : localStorage).getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v, s) { try { (s ? sessionStorage : localStorage).setItem(k, JSON.stringify(v)); } catch {} },
  del(k, s) { try { (s ? sessionStorage : localStorage).removeItem(k); } catch {} },
};
const rid = n => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
function code5() { const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; return Array.from(crypto.getRandomValues(new Uint8Array(5)), b => a[b % a.length]).join(""); }
// pid is per tab (sessionStorage) so a refresh keeps your seat, but two tabs are two players.
let me = store.get("dd-pid", null, true); if (!me) { me = rid(10); store.set("dd-pid", me, true); }
let profile = Object.assign({ name: "", av: AVATARS[Math.random() * AVATARS.length | 0], col: AVCOLS[Math.random() * AVCOLS.length | 0] }, store.get("dd-profile", {}));
let muted = store.get("dd-muted", false);

// ---------- ui helpers ----------
function el(tag, props, ...kids) { const e = document.createElement(tag); if (props) for (const [k, v] of Object.entries(props)) { if (k === "style" || k.startsWith("data-") || k.startsWith("aria-")) e.setAttribute(k, v); else e[k] = v; } e.append(...kids.flat().filter(k => k != null && k !== false)); return e; }
function toast(t, ms = 2400) { const d = el("div", { className: "toast" }, t); document.body.append(d); setTimeout(() => d.remove(), ms); }
function err(t) { $("err").textContent = t || ""; }
function vib(p) { try { navigator.vibrate && navigator.vibrate(p); } catch {} }
let sheetEl = null;
function openSheet(title, ...content) {
  closeSheet();
  sheetEl = el("div", { className: "sheetbg", onclick: e => { if (e.target === sheetEl) closeSheet(); } },
    el("div", { className: "sheet" }, el("div", { className: "grab" }), title ? el("h3", {}, title) : null, ...content));
  document.body.append(sheetEl);
}
function closeSheet() { if (sheetEl) { sheetEl.remove(); sheetEl = null; } }
function avatarEl(p, cls = "av") { return el("span", { className: cls, style: "background:" + (p.col || "#ddd") }, p.av || "🙂"); }

// ---------- sound ----------
let actx = null;
function audio() { if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch {} } if (actx && actx.state === "suspended") actx.resume(); return actx; }
document.addEventListener("pointerdown", () => audio(), { once: true });
function tone(f, d, type = "sine", v = .15, t0 = 0) {
  const a = audio(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + t0;
  o.type = type; o.frequency.setValueAtTime(f, t); g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(.001, t + d);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + d);
}
const SFX = {
  tick: () => tone(880, .05, "square", .05),
  ding: () => { tone(988, .12, "sine", .12); tone(1319, .2, "sine", .1, .1); },
  good: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, "triangle", .14, i * .08)); },
  close: () => tone(440, .15, "sawtooth", .06),
  turn: () => { tone(660, .12, "triangle", .12); tone(880, .2, "triangle", .12, .12); },
  pop: () => tone(600 + Math.random() * 400, .06, "sine", .06),
  end: () => { [523, 523, 523, 659, 784, 659, 784].forEach((f, i) => tone(f, .22, "triangle", .13, i * .14)); },
  reveal: () => tone(330, .3, "triangle", .1),
};
function sfx(n) { try { SFX[n] && SFX[n](); } catch {} }

// ---------- networking primitives ----------
let peer = null, isHost = false, hostConn = null, roomCode = null, leaving = false, kicked = false, migrating = false;
function openPeer(id) {
  return new Promise((res, rej) => {
    const p = id ? new Peer(id, ICE) : new Peer(ICE);
    let opened = false;
    const t = setTimeout(() => { if (!opened) { p.destroy(); rej({ type: "timeout" }); } }, 12000);
    p.on("open", () => { opened = true; clearTimeout(t); res(p); });
    p.on("error", e => { if (!opened) { clearTimeout(t); p.destroy(); rej(e); } });
  });
}
function send(m) { if (isHost) hostHandle(me, m); else if (hostConn && hostConn.open) hostConn.send(m); }
function myJoinMsg() { return { t: "join", pid: me, name: profile.name, av: profile.av, col: profile.col }; }

// Connect to a room as a client. Resolves true when connected.
async function connectTo(code, timeout = 7000) {
  if (!peer || peer.destroyed || isHost) { if (peer && !peer.destroyed) peer.destroy(); isHost = false; peer = await openPeer(); peer.on("error", () => {}); peer.on("disconnected", () => { try { if (!peer.destroyed) peer.reconnect(); } catch {} }); }
  else if (peer.disconnected) { try { peer.reconnect(); await sleep(800); } catch {} }
  return new Promise(res => {
    const c = peer.connect(PREFIX + code, { reliable: true });
    const t = setTimeout(() => { try { c.close(); } catch {} res(false); }, timeout);
    c.on("open", () => {
      clearTimeout(t); hostConn = c; roomCode = code; c.send(myJoinMsg());
      c.on("data", onMsg);
      c.on("close", () => { if (hostConn === c) { hostConn = null; onHostLost(); } });
      res(true);
    });
    c.on("error", () => { clearTimeout(t); res(false); });
  });
}

// ---------- host authority ----------
let H = null;
function newH(code) {
  return { code, settings: { ...DEFAULTS }, players: new Map(), order: [], turn: 0, round: 0, phase: "lobby", drawer: null, word: "", tier: "", choices: [], ends: 0, revealed: [],
    strokes: [], skip: new Set(), rated: new Map(), banned: new Set(), kicks: new Map(), used: new Set(), lowSince: 0, reactAt: new Map(), dirty: false };
}
async function becomeHost(code, restore) {
  const p = await openPeer(PREFIX + code); // throws on unavailable-id
  if (peer && peer !== p && !peer.destroyed) peer.destroy();
  peer = p; isHost = true; roomCode = code; hostConn = null;
  H = newH(code);
  if (restore) {
    Object.assign(H.settings, restore.settings || {});
    for (const q of restore.players || []) H.players.set(q.pid, { pid: q.pid, name: q.name, av: q.av, col: q.col, score: q.score || 0, ok: false, off: q.pid !== me, offAt: Date.now(), conn: null });
    H.order = (restore.order || []).filter(x => H.players.has(x)); H.round = restore.round || 0; H.turn = restore.turn || 0;
    if (restore.phase && restore.phase !== "lobby" && restore.phase !== "end") { H.phase = "reveal"; H.word = ""; H.ends = Date.now() + 5000; }
    else H.phase = restore.phase || "lobby";
  }
  if (!H.players.has(me)) H.players.set(me, { pid: me, name: profile.name, av: profile.av, col: profile.col, score: 0, ok: false, off: false, conn: null });
  else Object.assign(H.players.get(me), { off: false, name: profile.name, av: profile.av, col: profile.col });
  peer.on("connection", c => {
    c.on("data", m => hostHandle(c._pid || null, m, c));
    c.on("close", () => onConnClose(c));
    c.on("error", () => onConnClose(c));
  });
  peer.on("disconnected", () => { try { if (!peer.destroyed) peer.reconnect(); } catch {} });
  peer.on("error", e => console.warn("peer", e.type));
  pushState();
}
const active = () => [...H.players.values()].filter(p => !p.off);
function sendTo(pid, m) { if (pid === me) { onMsg(m); return; } const p = H.players.get(pid); if (p && p.conn && p.conn.open) { try { p.conn.send(m); } catch {} } }
function bcast(m, except) { for (const pid of H.players.keys()) if (pid !== except) sendTo(pid, m); }
function hchat(k, txt, n) { bcast({ t: "chat", k, txt, n }); }
function hintFor(pid) {
  if (!H.word) return "";
  const p = H.players.get(pid);
  if (H.phase === "reveal" || H.phase === "end" || pid === H.drawer || (p && p.ok)) return H.word;
  return [...H.word].map((ch, i) => ch === " " ? " " : (H.revealed.includes(i) ? ch : "_")).join("");
}
function snapshot() {
  return { settings: H.settings, players: [...H.players.values()].map(p => ({ pid: p.pid, name: p.name, av: p.av, col: p.col, score: p.score, off: p.off })), order: H.order, round: H.round, turn: H.turn, phase: H.phase };
}
function pushState() {
  if (!H) return;
  const players = [...H.players.values()].map(p => ({ pid: p.pid, name: p.name, av: p.av, col: p.col, score: p.score, ok: p.ok, off: p.off, kv: (H.kicks.get(p.pid) || new Set()).size }));
  const voters = active().filter(p => p.pid !== H.drawer).length;
  let likes = 0, dislikes = 0; for (const v of H.rated.values()) v > 0 ? likes++ : dislikes++;
  const base = { t: "state", code: H.code, phase: H.phase, round: H.round, drawer: H.drawer, left: Math.max(0, Math.round((H.ends - Date.now()) / 1000)), tier: H.tier, len: H.word.length,
    players, host: me, settings: H.settings, skip: H.skip.size, skipNeed: Math.floor(voters / 2) + 1, likes, dislikes, snap: snapshot() };
  for (const pid of H.players.keys()) sendTo(pid, { ...base, hint: hintFor(pid), voted: H.skip.has(pid), myRate: H.rated.get(pid) || 0 });
}
function joinOrRejoin(c, m) {
  const pid = String(m.pid || "").slice(0, 20); if (!pid) return;
  if (H.banned.has(pid)) { try { c.send({ t: "kicked" }); } catch {} setTimeout(() => c.close(), 300); return; }
  c._pid = pid;
  const name = String(m.name || "Player").slice(0, 16) || "Player", av = AVATARS.includes(m.av) ? m.av : "🙂", col = AVCOLS.includes(m.col) ? m.col : AVCOLS[0];
  let p = H.players.get(pid);
  if (p) {
    if (p.conn && p.conn !== c) try { p.conn.close(); } catch {}
    Object.assign(p, { conn: c, off: false, name, av, col });
    hchat("sys", name + " reconnected");
  } else {
    if (active().length >= H.settings.max) { try { c.send({ t: "full" }); } catch {} setTimeout(() => c.close(), 300); return; }
    p = { pid, name, av, col, score: 0, ok: false, off: false, conn: c };
    H.players.set(pid, p);
    if (H.phase !== "lobby" && H.phase !== "end") H.order.push(pid);
    hchat("sys", name + " joined");
  }
  c.send({ t: "strokes", s: H.strokes });
  if (pid === H.drawer && H.phase === "choose") c.send({ t: "choices", w: H.choices });
  if (pid === H.drawer && H.phase === "draw") c.send({ t: "word", w: H.word });
  pushState();
}
function onConnClose(c) {
  const p = H && H.players.get(c._pid); if (!p || p.conn !== c) return;
  p.conn = null; p.off = true; p.offAt = Date.now();
  hchat("sys", p.name + " disconnected");
  if (p.pid === H.drawer && (H.phase === "choose" || H.phase === "draw")) endTurn("The drawer left!");
  else checkAllGuessed();
  pushState();
}
function removePlayer(pid, why) {
  const p = H.players.get(pid); if (!p) return;
  if (p.conn) { try { p.conn.send({ t: "kicked" }); } catch {} const c = p.conn; setTimeout(() => { try { c.close(); } catch {} }, 300); }
  H.players.delete(pid); H.order = H.order.filter(x => x !== pid); H.kicks.delete(pid);
  for (const s of H.kicks.values()) s.delete(pid);
  if (why) hchat("bad", p.name + " " + why);
  if (pid === H.drawer && (H.phase === "choose" || H.phase === "draw")) endTurn();
  pushState();
}
function customWords() { return [...new Set(H.settings.custom.split(/[,\n]/).map(w => w.trim().toLowerCase()).filter(w => w.length >= 2 && w.length <= 30))]; }
function pickChoices() {
  const s = H.settings, n = s.choices, cw = customWords();
  let pool = (s.onlyCustom && cw.length >= n) ? cw : [...packWords(s.pack), ...cw];
  let fresh = pool.filter(w => !H.used.has(w)); if (fresh.length < n) { H.used.clear(); fresh = pool; }
  const shuffle = a => a.map(v => [Math.random(), v]).sort((x, y) => x[0] - y[0]).map(x => x[1]);
  let out = [];
  if (s.diff === "mixed") {
    const by = { easy: [], medium: [], hard: [] }; for (const w of shuffle(fresh)) by[tierOf(w)].push(w);
    const order = ["easy", "medium", "hard"];
    for (let i = 0; out.length < n && i < 50; i++) { const t = by[order[i % 3]]; if (t.length) out.push(t.shift()); }
  } else {
    const f = shuffle(fresh.filter(w => tierOf(w) === s.diff)); out = f.slice(0, n);
  }
  for (const w of shuffle(fresh)) { if (out.length >= n) break; if (!out.includes(w)) out.push(w); }
  return out.map(w => ({ w, tier: tierOf(w) }));
}
function startGame() {
  if (active().length < 2) { sendTo(me, { t: "chat", k: "bad", txt: "Need at least 2 players." }); return; }
  for (const p of [...H.players.values()]) { if (p.off) H.players.delete(p.pid); else { p.score = 0; p.ok = false; } }
  H.order = [...H.players.keys()].sort(() => Math.random() - .5); H.turn = 0; H.round = 1; H.used.clear();
  bcast({ t: "newgame" }); nextTurn();
}
function nextTurn() {
  if (active().length < 2) { H.phase = "lobby"; H.drawer = null; H.word = ""; hchat("sys", "Not enough players — back to the lobby."); pushState(); return; }
  for (let guard = 0; guard < 100; guard++) {
    if (H.turn >= H.order.length) { H.turn = 0; H.round++; }
    if (H.round > H.settings.rounds) { H.phase = "end"; H.word = ""; H.drawer = null; pushState(); return; }
    const d = H.order[H.turn++]; const p = H.players.get(d);
    if (p && !p.off) { H.drawer = d; break; }
  }
  for (const p of H.players.values()) p.ok = false;
  H.choices = pickChoices(); H.word = ""; H.tier = ""; H.revealed = []; H.skip.clear(); H.rated.clear();
  H.phase = "choose"; H.ends = Date.now() + PICK_S * 1000; H.strokes = [];
  bcast({ t: "clear" });
  sendTo(H.drawer, { t: "choices", w: H.choices });
  pushState();
}
function pickWord(i) {
  if (H.phase !== "choose") return; const c = H.choices[i]; if (!c) return;
  H.word = c.w; H.tier = c.tier; H.used.add(c.w); H.phase = "draw"; H.ends = Date.now() + H.settings.time * 1000; H.revealed = [];
  sendTo(H.drawer, { t: "word", w: H.word });
  hchat("sys", (H.players.get(H.drawer)?.name || "Someone") + " is drawing!");
  pushState();
}
function endTurn(reason) {
  if (H.phase !== "draw" && H.phase !== "choose") return;
  const had = H.word;
  H.phase = "reveal"; H.ends = Date.now() + REVEAL_S * 1000;
  if (!had) H.word = H.choices[0]?.w || "";
  hchat("sys", (reason ? reason + " " : "") + "The word was “" + H.word + "”");
  bcast({ t: "turnEnd", word: H.word, by: H.players.get(H.drawer)?.name || "", drew: !!had });
  pushState();
}
function checkAllGuessed() {
  if (H.phase !== "draw") return;
  const others = active().filter(p => p.pid !== H.drawer);
  if (others.length && others.every(p => p.ok)) endTurn("Everyone guessed it!");
}
const norm = s => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
function lev(a, b) { const d = Array.from({ length: a.length + 1 }, (_, i) => [i]); for (let j = 1; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; }
function cleanSettings(s) {
  const o = { ...H.settings }, clamp = (v, a, b, d) => { v = parseInt(v); return isNaN(v) ? d : Math.max(a, Math.min(b, v)); };
  o.rounds = clamp(s.rounds, 1, 10, 3); o.time = clamp(s.time, 30, 240, 80); o.choices = clamp(s.choices, 1, 5, 3); o.max = clamp(s.max, 2, 12, 10);
  o.pack = PACKS[s.pack] ? s.pack : "general"; o.diff = ["mixed", "easy", "medium", "hard"].includes(s.diff) ? s.diff : "mixed";
  o.custom = String(s.custom || "").slice(0, 3000); o.onlyCustom = !!s.onlyCustom; o.public = !!s.public;
  return o;
}
function validOp(o) {
  if (!o || typeof o !== "object") return null;
  const k = ["pen", "line", "rect", "oval", "fill"].includes(o.k) ? o.k : null; if (!k) return null;
  const c = /^#[0-9a-f]{6}$/i.test(o.c) ? o.c : "#111111", w = Math.max(1, Math.min(60, +o.w || 8));
  const p = Array.isArray(o.p) ? o.p.slice(0, 4000).map(Number).filter(Number.isFinite) : [];
  return { k, c, w, p };
}
function hostHandle(from, m, conn) {
  if (!m || typeof m !== "object") return;
  if (m.t === "join") { if (conn) joinOrRejoin(conn, m); return; }
  const p = H.players.get(from); if (!p) return;
  const isDrawer = from === H.drawer;
  switch (m.t) {
    case "start": if (from === me && (H.phase === "lobby" || H.phase === "end")) startGame(); break;
    case "settings": if (from === me && (H.phase === "lobby" || H.phase === "end")) { H.settings = cleanSettings(m.s || {}); pushState(); lobbyTick(); } break;
    case "pick": if (isDrawer) pickWord(m.i | 0); break;
    case "sb": case "sp": case "undo": case "clear": {
      if (!isDrawer || H.phase !== "draw") return;
      if (m.t === "sb") { const o = validOp(m.o); if (!o) return; if (H.strokes.length < 3000) H.strokes.push(o); bcast({ t: "sb", o }, from); }
      else if (m.t === "sp") { const s = H.strokes[H.strokes.length - 1]; const pts = Array.isArray(m.p) ? m.p.slice(0, 2000).map(Number).filter(Number.isFinite) : []; if (s && s.k === "pen" && s.p.length < 30000) s.p.push(...pts); bcast({ t: "sp", p: pts }, from); }
      else if (m.t === "undo") { H.strokes.pop(); bcast(m, from); }
      else { H.strokes = []; bcast(m, from); }
      break;
    }
    case "react": {
      if (!EMOJIS.includes(m.e)) return; const now = Date.now(); if (now - (H.reactAt.get(from) || 0) < 350) return; H.reactAt.set(from, now);
      bcast({ t: "react", e: m.e }); break;
    }
    case "skip": {
      if (H.phase !== "draw" || isDrawer) return;
      H.skip.has(from) ? H.skip.delete(from) : H.skip.add(from);
      const need = Math.floor(active().filter(q => q.pid !== H.drawer).length / 2) + 1;
      if (H.skip.size >= need) endTurn("Skipped by vote.");
      else pushState();
      break;
    }
    case "rate": {
      if (H.phase !== "reveal" || isDrawer || H.rated.has(from) || !H.drawer) return;
      const v = m.v > 0 ? 1 : -1; H.rated.set(from, v);
      if (v > 0) { const d = H.players.get(H.drawer); if (d) d.score += 10; }
      pushState(); break;
    }
    case "kick": {
      const target = H.players.get(m.pid); if (!target || m.pid === me) return;
      if (from === me) { H.banned.add(m.pid); removePlayer(m.pid, "was removed by the host"); return; }
      if (m.pid === from) return;
      const s = H.kicks.get(m.pid) || new Set(); s.add(from); H.kicks.set(m.pid, s);
      const voters = active().filter(q => q.pid !== m.pid).length, need = Math.max(2, Math.floor(voters / 2) + 1);
      hchat("sys", p.name + " voted to kick " + target.name + " (" + s.size + "/" + need + ")");
      if (s.size >= need) { H.banned.add(m.pid); removePlayer(m.pid, "was kicked by vote"); } else pushState();
      break;
    }
    case "guess": {
      const txt = String(m.txt || "").slice(0, 60).trim(); if (!txt) return;
      if (H.phase === "draw" && !isDrawer && !p.ok) {
        const g = norm(txt), w = norm(H.word);
        if (g === w) {
          const left = Math.max(0, H.ends - Date.now()) / 1000, mult = TIER_MULT[H.tier] || 1;
          const nOk = active().filter(x => x.ok).length;
          const pts = Math.max(50, Math.round((100 + 300 * left / H.settings.time) * mult) - nOk * 15);
          p.score += pts; p.ok = true;
          const d = H.players.get(H.drawer); if (d) d.score += Math.round(40 * mult);
          sendTo(from, { t: "you", k: "good", pts });
          bcast({ t: "chat", k: "good", txt: p.name + " guessed the word!", ding: 1 }, from);
          sendTo(from, { t: "chat", k: "good", txt: "You guessed it! +" + pts });
          pushState(); checkAllGuessed(); return;
        }
        if (w.length > 3 && (lev(g, w) <= (w.length > 7 ? 2 : 1) || (g.length >= 4 && w.includes(g) && g.length >= w.length - 2))) sendTo(from, { t: "you", k: "close", txt });
      }
      if (H.phase === "draw" && (isDrawer || p.ok)) { // only those who know the word see this chat
        for (const q of H.players.values()) if (q.ok || q.pid === H.drawer) sendTo(q.pid, { t: "chat", k: "m", n: p.name, txt });
        return;
      }
      hchat("m", txt, p.name); break;
    }
  }
}
setInterval(() => {
  if (!isHost || !H) return;
  const now = Date.now();
  // drop players who have been gone for 2 minutes
  for (const p of [...H.players.values()]) if (p.off && now - p.offAt > 120000) { H.players.delete(p.pid); H.order = H.order.filter(x => x !== p.pid); H.dirty = true; }
  if (H.phase !== "lobby" && H.phase !== "end") {
    if (active().length < 2) { if (!H.lowSince) H.lowSince = now; else if (now - H.lowSince > 20000) { H.lowSince = 0; H.phase = "lobby"; H.drawer = null; H.word = ""; hchat("sys", "Everyone else left — back to the lobby."); H.dirty = true; } }
    else H.lowSince = 0;
  }
  if (H.phase === "choose" && now >= H.ends) pickWord(Math.random() * H.choices.length | 0);
  else if (H.phase === "draw") {
    if (now >= H.ends) { endTurn("Time's up!"); return; }
    const frac = 1 - (H.ends - now) / (H.settings.time * 1000), letters = [...H.word].map((c, i) => c === " " ? -1 : i).filter(i => i >= 0);
    const want = Math.min(Math.floor(letters.length / 2), frac > .8 ? 3 : frac > .6 ? 2 : frac > .4 ? 1 : 0);
    if (H.revealed.length < want) { const hid = letters.filter(i => !H.revealed.includes(i)); H.revealed.push(hid[Math.random() * hid.length | 0]); H.dirty = true; }
  } else if (H.phase === "reveal" && now >= H.ends) nextTurn();
  if (H.dirty) { H.dirty = false; pushState(); }
}, 400);
setInterval(() => { if (isHost && H) pushState(); }, 5000); // keep timers in sync

// ---------- public room directory (no backend: the first public host also keeps the list) ----------
let dirPeer = null, dirConn = null, dirRooms = new Map(), dirBusy = false;
function roomInfo() { return { code: H.code, host: profile.name, av: profile.av, n: active().length, max: H.settings.max, phase: H.phase, pack: PACKS[H.settings.pack]?.label || "", at: Date.now() }; }
function dirHandle(c, m) {
  if (m.t === "reg" && m.r && /^[A-Z0-9]{5}$/.test(m.r.code)) dirRooms.set(m.r.code, { ...m.r, host: String(m.r.host).slice(0, 16), at: Date.now() });
  else if (m.t === "unreg") dirRooms.delete(m.code);
  else if (m.t === "list") {
    const now = Date.now(); for (const [k, r] of dirRooms) if (now - r.at > 25000) dirRooms.delete(k);
    if (isHost && H && H.settings.public) dirRooms.set(H.code, roomInfo());
    c.send({ t: "rooms", list: [...dirRooms.values()].filter(r => r.n < r.max).slice(0, 30) });
  }
}
async function lobbyTick() {
  if (!isHost || !H || dirBusy) return;
  if (!H.settings.public) { if (dirConn && dirConn.open) dirConn.send({ t: "unreg", code: H.code }); dirRooms.delete(H.code); return; }
  if (dirPeer && !dirPeer.destroyed) { dirRooms.set(H.code, roomInfo()); return; }
  if (dirConn && dirConn.open) { dirConn.send({ t: "reg", r: roomInfo() }); return; }
  dirBusy = true;
  try {
    dirPeer = await openPeer(LOBBY_ID);
    dirPeer.on("connection", c => c.on("data", m => dirHandle(c, m)));
    dirPeer.on("error", () => {});
    dirRooms.set(H.code, roomInfo());
  } catch (e) {
    dirPeer = null;
    if (e.type === "unavailable-id" && peer && !peer.destroyed) {
      const c = peer.connect(LOBBY_ID); dirConn = c;
      c.on("open", () => c.send({ t: "reg", r: roomInfo() }));
      c.on("close", () => { if (dirConn === c) dirConn = null; });
    }
  }
  dirBusy = false;
}
setInterval(lobbyTick, 8000);
async function browseRooms() {
  const box = $("rooms"); box.classList.remove("hide"); box.replaceChildren(el("div", { className: "dim" }, "Looking for rooms…"));
  let p;
  try { p = await openPeer(); } catch { box.replaceChildren(el("div", { className: "dim" }, "Couldn't reach the server. Try again.")); return; }
  const list = await new Promise(res => {
    const t = setTimeout(() => res([]), 6000);
    p.on("error", () => { clearTimeout(t); res([]); });
    const c = p.connect(LOBBY_ID);
    c.on("open", () => c.send({ t: "list" }));
    c.on("data", m => { if (m.t === "rooms") { clearTimeout(t); res(m.list || []); } });
  });
  p.destroy();
  if (!list.length) { box.replaceChildren(el("div", { className: "dim" }, "No public rooms right now. Create one and tick “Public room”!")); return; }
  box.replaceChildren(...list.map(r => el("div", { className: "roomrow" }, el("span", { style: "font-size:24px" }, r.av || "🎨"),
    el("div", {}, el("b", {}, r.host + "'s room"), el("small", {}, r.n + "/" + r.max + " players · " + r.pack + (r.phase === "lobby" ? " · waiting" : " · playing"))),
    el("button", { onclick: () => joinRoom(r.code) }, "Join"))));
}

// ---------- client state ----------
let view = { phase: "lobby", players: [], settings: { ...DEFAULTS } };
let strokes = [], myWord = null, choices = null, localEnd = 0, gallery = [], lastTick = -1;
function onMsg(m) {
  switch (m.t) {
    case "state": {
      const prev = view.phase, prevDrawer = view.drawer; view = m; localEnd = Date.now() + m.left * 1000;
      if (m.snap) store.set("dd-snap", { code: m.code, snap: m.snap, host: m.host }, true);
      if (m.phase !== "draw" && m.phase !== "choose") myWord = null;
      if (m.phase !== "choose") choices = null;
      if (prev !== m.phase) {
        if (m.phase === "choose" && m.drawer === me) { sfx("turn"); vib([60, 40, 60]); }
        if (m.phase === "end") { sfx("end"); confetti(); }
        if (m.phase === "draw" && m.drawer !== me && prevDrawer !== undefined) flash((m.players.find(p => p.pid === m.drawer)?.name || "") + " is drawing", "info");
      }
      render(); break;
    }
    case "choices": choices = m.w; render(); break;
    case "word": myWord = m.w; render(); break;
    case "chat": chat(m); if (m.ding) { sfx("ding"); } break;
    case "you":
      if (m.k === "good") { flash("Correct! +" + m.pts, "good"); sfx("good"); vib([40, 30, 80]); }
      else { flash("“" + m.txt + "” is close!", "close"); sfx("close"); vib(30); chat({ k: "close", txt: "“" + m.txt + "” is close!" }); }
      break;
    case "strokes": strokes = (m.s || []).slice(); redraw(); break;
    case "sb": strokes.push(m.o); drawOp(m.o, 0); break;
    case "sp": { const s = strokes[strokes.length - 1]; if (s && s.k === "pen") { const from = s.p.length; s.p.push(...m.p); drawPen(s, from); } break; }
    case "undo": strokes.pop(); redraw(); break;
    case "clear": strokes = []; redraw(); break;
    case "react": floatEmoji(m.e); sfx("pop"); break;
    case "turnEnd": if (m.drew && strokes.length) gallery.push({ word: m.word, by: m.by, strokes: strokes.slice() }); sfx("reveal"); break;
    case "newgame": gallery = []; break;
    case "full": err("That room is full."); toast("Room is full"); break;
    case "kicked": kicked = true; leaveGame("You were removed from the room."); break;
  }
}
function chat(m) {
  const box = $("chat"), stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 40;
  const d = el("div", { className: m.k === "m" ? "m" : m.k });
  if (m.k === "m") d.append(el("b", {}, m.n + ": "), m.txt); else d.textContent = m.txt;
  box.append(d); while (box.children.length > 150) box.firstChild.remove();
  if (stick) box.scrollTop = box.scrollHeight;
}
const sys = txt => chat({ k: "sys", txt });
function flash(txt, kind) { const f = el("div", { className: "flash " + kind }, txt); document.querySelector(".stage").append(f); setTimeout(() => f.remove(), 1700); }
function floatEmoji(e) { const f = el("div", { className: "react", style: "left:" + (10 + Math.random() * 75) + "%" }, e); document.querySelector(".stage").append(f); setTimeout(() => f.remove(), 2300); }
function banner(t) { const b = $("banner"); if (t) { b.textContent = t; b.classList.remove("hide"); } else b.classList.add("hide"); }

// ---------- entering / leaving ----------
function saveSession() { store.set("dd-session", { code: roomCode }, true); }
function enterGame() {
  err(""); closeSheet(); $("home").classList.add("hide"); $("game").classList.remove("hide"); document.body.classList.add("ingame");
  history.replaceState(null, "", "?r=" + roomCode); saveSession(); render(); fitViewport();
}
function leaveGame(msg) {
  leaving = true; store.del("dd-session", true); store.del("dd-snap", true);
  try { peer && peer.destroy(); } catch {} try { dirPeer && dirPeer.destroy(); } catch {}
  peer = null; dirPeer = null; dirConn = null; isHost = false; H = null; hostConn = null;
  if (msg) store.set("dd-flash", msg, true);
  location.href = location.pathname;
}
function needName() {
  const n = $("name").value.trim().slice(0, 16);
  if (!n) { err("Enter a name first"); $("name").focus(); return false; }
  profile.name = n; store.set("dd-profile", profile); return true;
}
async function createRoom() {
  if (!needName()) return;
  err("Creating room…"); $("btnCreate").disabled = true;
  for (let i = 0; i < 4; i++) {
    try { await becomeHost(code5()); sys("Room created. Tap 📤 to invite friends."); enterGame(); $("btnCreate").disabled = false; return; }
    catch (e) { if (e.type !== "unavailable-id") { err("Couldn't create a room (" + e.type + "). Check your connection."); break; } }
  }
  $("btnCreate").disabled = false;
}
async function joinRoom(code) {
  if (!needName()) return;
  code = String(code || "").toUpperCase().trim();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) { err("Enter a valid room code"); return; }
  err("Connecting…");
  try {
    for (let i = 0; i < 2; i++) if (await connectTo(code)) { sys("Joined room " + code + "."); enterGame(); return; }
    err("Room not found. Check the code or ask for a new link.");
  } catch (e) { err("Couldn't connect (" + (e.type || "error") + ")."); }
}
// Host vanished: every client knows the same candidate order, so they agree on who takes over.
async function onHostLost() {
  if (leaving || kicked || migrating || isHost) return;
  migrating = true; banner("Host disconnected — reconnecting…"); sys("Lost the host. Reconnecting…");
  const saved = store.get("dd-snap", null, true), oldHost = view.host;
  const cands = (saved?.snap?.players || []).filter(p => p.pid !== oldHost && !p.off).map(p => p.pid);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000 && !leaving) {
    const idx = Math.floor((Date.now() - t0) / 9000);
    if (cands[idx] === me || (idx >= cands.length && cands.includes(me))) {
      try { await becomeHost(roomCode, saved?.snap); migrating = false; banner(""); hchat("sys", profile.name + " is the new host."); render(); return; } catch {}
    } else if (await connectTo(roomCode, 4000)) { migrating = false; banner(""); sys("Reconnected."); return; }
    await sleep(1500);
  }
  migrating = false; banner("Couldn't reconnect to the room."); toast("Couldn't reconnect. Create a new room from the home screen.", 5000);
}
// Page reload while in a room: rejoin the same seat (or reclaim the room if nobody else is there).
async function resumeSession(code) {
  $("home").classList.add("hide"); $("game").classList.remove("hide"); document.body.classList.add("ingame");
  roomCode = code; banner("Reconnecting to room " + code + "…"); render(); fitViewport();
  const saved = store.get("dd-snap", null, true);
  const t0 = Date.now();
  while (Date.now() - t0 < 45000) {
    try { if (await connectTo(code, 4000)) { banner(""); sys("Reconnected to room " + code + "."); saveSession(); return; } } catch {}
    if (Date.now() - t0 > 12000) { // nobody answered: take the room back
      try { await becomeHost(code, saved?.code === code ? saved.snap : null); banner(""); sys("Room restored. Invite friends with 📤."); saveSession(); return; } catch {}
    }
    await sleep(1500);
  }
  banner(""); leaveGame("Couldn't reconnect to that room.");
}

// ---------- rendering ----------
const nameOf = pid => (view.players || []).find(p => p.pid === pid)?.name || "Someone";
function render() {
  const v = view, drawing = v.phase === "draw" && v.drawer === me, mep = (v.players || []).find(p => p.pid === me);
  // players
  const sorted = [...(v.players || [])].sort((a, b) => b.score - a.score);
  $("players").replaceChildren(...sorted.map((p, i) => el("button", { className: "chip" + (p.pid === me ? " me" : "") + (p.ok ? " ok" : "") + (p.off ? " off" : ""), type: "button", onclick: () => playerSheet(p) },
    avatarEl(p), (p.pid === v.drawer ? "✏️ " : "") + (i === 0 && p.score > 0 ? "👑 " : "") + p.name, el("b", {}, String(p.score)))));
  // top
  const hw = $("hintW"), sub = $("hintSub");
  if (v.phase === "draw") { hw.textContent = drawing ? (myWord || v.hint) : v.hint; sub.textContent = drawing ? "Draw this!" : (mep?.ok ? "You got it!" : v.len + " letters · " + (v.tier || "")); }
  else if (v.phase === "choose") { hw.textContent = "…"; sub.textContent = v.drawer === me ? "Pick a word" : nameOf(v.drawer) + " is choosing"; }
  else if (v.phase === "reveal") { hw.textContent = v.hint || "…"; sub.textContent = "Round " + v.round + " of " + v.settings.rounds; }
  else { hw.textContent = v.phase === "end" ? "Game over" : "Lobby"; sub.textContent = roomCode ? "Room " + roomCode : ""; }
  if (v.phase === "draw" || v.phase === "choose") sub.textContent += (sub.textContent ? " · " : "") + "R" + v.round + "/" + v.settings.rounds;
  $("btnMute").textContent = muted ? "🔇" : "🔊";
  // drawer tools / guesser bar
  $("tools").classList.toggle("hide", !drawing); if (drawing) buildTools();
  const guessing = v.phase === "draw" && !drawing && mep;
  $("gbar").classList.toggle("hide", !guessing); if (guessing) buildGbar();
  $("msg").placeholder = drawing ? "You're drawing — chat…" : (v.phase === "draw" && mep?.ok ? "You got it! Chat with winners…" : "Type your guess…");
  renderOverlay();
}
function buildGbar() {
  const v = view;
  $("gbar").replaceChildren(...EMOJIS.map(e => el("button", { className: "em", type: "button", onclick: () => send({ t: "react", e }) }, e)),
    el("button", { className: "skip" + (v.voted ? " on" : ""), type: "button", onclick: () => send({ t: "skip" }) }, "⏭ Skip " + v.skip + "/" + v.skipNeed));
}
function renderOverlay() {
  const v = view, ov = $("ov"), ae = document.activeElement;
  if (ae && ov.contains(ae) && /^(TEXTAREA|SELECT|INPUT)$/.test(ae.tagName) && v.phase === "lobby") return; // don't wipe a form the host is editing
  ov.replaceChildren(); ov.classList.remove("hide");
  if (!v.code && !isHost) { ov.append(el("h2", {}, "Connecting…")); return; }
  if (v.phase === "lobby") {
    ov.append(el("h2", {}, "Room " + (roomCode || "")), el("div", {}, (v.players || []).filter(p => !p.off).length + " / " + v.settings.max + " players"));
    ov.append(el("button", { onclick: shareSheet }, "📤 Invite friends"));
    if (isHost) { ov.append(settingsSummary(), el("button", { className: "soft", onclick: () => openSheet("Room settings", settingsForm(), el("button", { onclick: closeSheet }, "Done")) }, "⚙️ Room settings")); const n = active().length; ov.append(el("button", { className: "ghost", style: "color:#fff;border-color:#fff", disabled: n < 2, onclick: () => send({ t: "start" }) }, n < 2 ? "Waiting for 1 more player…" : "▶ Start game")); }
    else ov.append(settingsSummary(), el("div", { className: "dim", style: "color:#c7c5ee" }, "Waiting for the host to start…"));
  } else if (v.phase === "choose") {
    if (choices && v.drawer === me) ov.append(el("h2", {}, "Pick a word to draw"), el("div", { className: "words" }, ...choices.map((c, i) => el("button", { onclick: () => { send({ t: "pick", i }); choices = null; render(); } }, c.w, el("small", {}, c.tier + " · ×" + TIER_MULT[c.tier])))));
    else ov.append(el("h2", {}, nameOf(v.drawer) + " is choosing a word…"));
  } else if (v.phase === "reveal") {
    ov.append(el("div", {}, "The word was"), el("h2", { style: "font-size:28px" }, v.hint || "—"));
    if (v.drawer && v.drawer !== me && v.hint) ov.append(el("div", {}, "Rate " + nameOf(v.drawer) + "'s drawing"), el("div", { className: "rate" },
      el("button", { className: v.myRate > 0 ? "on" : "", disabled: !!v.myRate, onclick: () => send({ t: "rate", v: 1 }) }, "👍 " + v.likes),
      el("button", { className: v.myRate < 0 ? "on" : "", disabled: !!v.myRate, onclick: () => send({ t: "rate", v: -1 }) }, "👎 " + v.dislikes)));
    else if (v.drawer === me) ov.append(el("div", {}, "👍 " + v.likes + "  ·  👎 " + v.dislikes));
  } else if (v.phase === "end") {
    const r = [...v.players].sort((a, b) => b.score - a.score);
    ov.append(el("h2", {}, "🏆 " + (r[0]?.name || "") + " wins!"), podium(r));
    if (r.length > 3) ov.append(el("div", { style: "font-size:14px" }, r.slice(3).map((p, i) => (i + 4) + ". " + p.name + " — " + p.score).join("  ·  ")));
    if (gallery.length) ov.append(el("div", { style: "font-size:13px;color:#c7c5ee" }, "Tap a drawing to save it"), galleryEl());
    if (isHost) ov.append(el("button", { onclick: () => send({ t: "start" }) }, "🔁 Play again"), el("button", { className: "ghost", style: "color:#fff;border-color:#fff", onclick: () => { H.phase = "lobby"; pushState(); } }, "⚙️ Change settings"));
    else ov.append(el("div", { className: "dim", style: "color:#c7c5ee" }, "Waiting for the host…"));
  } else ov.classList.add("hide");
}
function podium(r) {
  const spots = [[r[1], 2, 70, "#cbd5e1"], [r[0], 1, 100, "#facc15"], [r[2], 3, 50, "#d97706"]];
  return el("div", { className: "podium" }, ...spots.filter(s => s[0]).map(([p, n, h, c]) => el("div", { className: "pod" }, avatarEl(p), el("div", { className: "nm" }, p.name), el("div", { style: "font-size:12px" }, p.score + " pts"), el("div", { className: "bar", style: "height:" + h + "px;background:" + c }, String(n)))));
}
function settingsSummary() { const s = view.settings; return el("div", { style: "font-size:14px;color:#c7c5ee" }, s.rounds + " rounds · " + s.time + "s · " + (PACKS[s.pack]?.label || "") + " · " + s.diff + (s.custom ? " · custom words" : "")); }
let settingsDraft = null;
function settingsForm() {
  const s = H.settings, sel = (k, opts) => el("select", { onchange: e => upd(k, e.target.value) }, ...opts.map(([v, t]) => el("option", { value: v, selected: String(s[k]) === String(v) }, t)));
  const upd = (k, val) => send({ t: "settings", s: { ...H.settings, [k]: val } });
  const ta = el("textarea", { placeholder: "Your own words, comma separated", value: s.custom, maxLength: 3000 }); ta.addEventListener("change", () => upd("custom", ta.value));
  return el("div", { className: "settings" },
    el("label", {}, "Rounds", sel("rounds", [1, 2, 3, 4, 5, 6, 8, 10].map(n => [n, n]))),
    el("label", {}, "Draw time", sel("time", [30, 45, 60, 80, 100, 120, 150, 180].map(n => [n, n + "s"]))),
    el("label", {}, "Word choices", sel("choices", [1, 2, 3, 4, 5].map(n => [n, n]))),
    el("label", {}, "Max players", sel("max", [2, 4, 6, 8, 10, 12].map(n => [n, n]))),
    el("label", {}, "Word pack", sel("pack", Object.entries(PACKS).map(([k, p]) => [k, p.label]))),
    el("label", {}, "Difficulty", sel("diff", [["mixed", "Mixed"], ["easy", "Easy"], ["medium", "Medium"], ["hard", "Hard"]])),
    el("label", { className: "full" }, "Custom words", ta),
    el("label", { className: "chk full" }, el("input", { type: "checkbox", checked: s.onlyCustom, onchange: e => upd("onlyCustom", e.target.checked) }), "Use only custom words (needs at least as many words as choices)"),
    el("label", { className: "chk full" }, el("input", { type: "checkbox", checked: s.public, onchange: e => upd("public", e.target.checked) }), "Public room (listed in “Browse public rooms”)"));
}
function playerSheet(p) {
  const kids = [el("div", { style: "display:flex;align-items:center;gap:12px;justify-content:center" }, avatarEl(p, "avbig"), el("div", {}, el("b", { style: "font-size:20px" }, p.name), el("div", { className: "dim" }, p.score + " points" + (p.off ? " · offline" : ""))))];
  if (p.pid !== me) {
    if (isHost) kids.push(el("button", { style: "background:var(--bad)", onclick: () => { send({ t: "kick", pid: p.pid }); closeSheet(); } }, "Remove from room"));
    else kids.push(el("button", { style: "background:var(--bad)", onclick: () => { send({ t: "kick", pid: p.pid }); closeSheet(); toast("Vote counted"); } }, "Vote to kick (" + (p.kv || 0) + " votes)"));
  }
  kids.push(el("button", { className: "soft", onclick: closeSheet }, "Close"));
  openSheet(null, ...kids);
}
function inviteUrl() { return location.origin + location.pathname + "?r=" + roomCode; }
function shareSheet() {
  const url = inviteUrl(), qr = el("div", { className: "qr" });
  try { const q = qrcode(0, "M"); q.addData(url); q.make(); qr.innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); } catch { qr.textContent = "QR unavailable"; }
  openSheet("Invite friends", qr, el("div", { style: "text-align:center;font-size:28px;font-weight:800;letter-spacing:.2em" }, roomCode), el("div", { className: "link" }, url),
    navigator.share ? el("button", { onclick: async () => { try { await navigator.share({ title: "Doodle Duel", text: "Join my Doodle Duel room! Code " + roomCode, url }); } catch {} } }, "📤 Share link") : null,
    el("button", { className: navigator.share ? "soft" : "", onclick: async () => { try { await navigator.clipboard.writeText(url); toast("Link copied"); } catch { prompt("Copy this link:", url); } } }, "📋 Copy link"));
}
function menuSheet() {
  openSheet("Menu",
    el("button", { className: "soft", onclick: () => { closeSheet(); shareSheet(); } }, "📤 Invite / QR code"),
    el("button", { className: "soft", onclick: () => { muted = !muted; store.set("dd-muted", muted); render(); closeSheet(); } }, muted ? "🔊 Sound on" : "🔇 Mute sounds"),
    deferredInstall ? el("button", { className: "soft", onclick: () => { closeSheet(); install(); } }, "📲 Install app") : null,
    el("button", { style: "background:var(--bad)", onclick: () => { if (!isHost || active().length < 2 || confirm("You're the host. Someone else will take over. Leave?")) leaveGame(); } }, "🚪 Leave room"),
    el("button", { className: "soft", onclick: closeSheet }, "Close"));
}
setInterval(() => {
  const t = $("timer"); const ph = view.phase;
  if (ph === "draw" || ph === "choose" || ph === "reveal") {
    const s = Math.max(0, Math.ceil((localEnd - Date.now()) / 1000)); t.textContent = s;
    const low = ph === "draw" && s <= 10; t.classList.toggle("low", low);
    if (low && s !== lastTick && s > 0) { lastTick = s; sfx("tick"); }
  } else { t.textContent = "–"; t.classList.remove("low"); }
}, 200);

// ---------- canvas: drawing, smoothing, fill, shapes ----------
const cv = $("cv"), ctx = cv.getContext("2d", { willReadFrequently: true }), W = cv.width, HH = cv.height;
let color = COLORS[0], size = SIZES[1], tool = "pen", shape = "line";
function clearCanvas(c = ctx) { c.fillStyle = "#fff"; c.fillRect(0, 0, W, HH); }
function drawPen(s, from, c = ctx) { // quadratic smoothing through midpoints
  const p = s.p; c.strokeStyle = s.c; c.fillStyle = s.c; c.lineWidth = s.w; c.lineCap = "round"; c.lineJoin = "round";
  const n = p.length / 2; if (n === 0) return;
  const X = i => p[i * 2] * W, Y = i => p[i * 2 + 1] * HH;
  if (n === 1) { c.beginPath(); c.arc(X(0), Y(0), s.w / 2, 0, 7); c.fill(); return; }
  let i0 = Math.max(1, Math.floor(from / 2));
  c.beginPath();
  for (let i = i0; i < n; i++) {
    const sx = i === 1 ? X(0) : (X(i - 1) + X(i - 2)) / 2, sy = i === 1 ? Y(0) : (Y(i - 1) + Y(i - 2)) / 2;
    const ex = (X(i) + X(i - 1)) / 2, ey = (Y(i) + Y(i - 1)) / 2;
    c.moveTo(sx, sy); c.quadraticCurveTo(X(i - 1), Y(i - 1), ex, ey);
  }
  c.stroke();
}
function penTail(s, c = ctx) { const p = s.p, n = p.length / 2; if (n < 2) return; c.beginPath(); c.strokeStyle = s.c; c.lineWidth = s.w; c.lineCap = "round"; c.moveTo((p[n * 2 - 4] + p[n * 2 - 2]) / 2 * W, (p[n * 2 - 3] + p[n * 2 - 1]) / 2 * HH); c.lineTo(p[n * 2 - 2] * W, p[n * 2 - 1] * HH); c.stroke(); }
function drawShape(o, c = ctx) {
  const [a, b, x, y] = o.p; if (o.p.length < 4) return;
  c.strokeStyle = o.c; c.lineWidth = o.w; c.lineCap = "round"; c.lineJoin = "round"; c.beginPath();
  if (o.k === "line") { c.moveTo(a * W, b * HH); c.lineTo(x * W, y * HH); }
  else if (o.k === "rect") c.rect(Math.min(a, x) * W, Math.min(b, y) * HH, Math.abs(x - a) * W, Math.abs(y - b) * HH);
  else c.ellipse((a + x) / 2 * W, (b + y) / 2 * HH, Math.abs(x - a) / 2 * W, Math.abs(y - b) / 2 * HH, 0, 0, 7);
  c.stroke();
}
function floodFill(nx, ny, hex, c = ctx) {
  const x0 = Math.floor(nx * W), y0 = Math.floor(ny * HH); if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= HH) return;
  const img = c.getImageData(0, 0, W, HH), d = img.data, i0 = (y0 * W + x0) * 4;
  const tr = d[i0], tg = d[i0 + 1], tb = d[i0 + 2];
  const fr = parseInt(hex.slice(1, 3), 16), fg = parseInt(hex.slice(3, 5), 16), fb = parseInt(hex.slice(5, 7), 16);
  if (Math.abs(tr - fr) + Math.abs(tg - fg) + Math.abs(tb - fb) < 10) return;
  const tol = 90, match = i => Math.abs(d[i] - tr) + Math.abs(d[i + 1] - tg) + Math.abs(d[i + 2] - tb) <= tol;
  const seen = new Uint8Array(W * HH), stack = [x0, y0];
  while (stack.length) {
    const y = stack.pop(), x = stack.pop(); let l = x;
    while (l >= 0 && !seen[y * W + l] && match((y * W + l) * 4)) l--;
    l++; let up = false, dn = false;
    for (let r = l; r < W && !seen[y * W + r] && match((y * W + r) * 4); r++) {
      const k = y * W + r; seen[k] = 1; d[k * 4] = fr; d[k * 4 + 1] = fg; d[k * 4 + 2] = fb; d[k * 4 + 3] = 255;
      if (y > 0) { const u = k - W; if (!seen[u] && match(u * 4)) { if (!up) { stack.push(r, y - 1); up = true; } } else up = false; }
      if (y < HH - 1) { const b = k + W; if (!seen[b] && match(b * 4)) { if (!dn) { stack.push(r, y + 1); dn = true; } } else dn = false; }
    }
  }
  // grow the fill 1px into anti-aliased edges
  c.putImageData(img, 0, 0);
}
function drawOp(o, from, c = ctx) {
  if (o.k === "pen") drawPen(o, from, c); else if (o.k === "fill") floodFill(o.p[0], o.p[1], o.c, c); else drawShape(o, c);
}
function renderAll(list, c, done) { clearCanvas(c); for (const o of list) { drawOp(o, 0, c); if (o.k === "pen") penTail(o, c); } }
function redraw() { renderAll(strokes, ctx); }
clearCanvas();

// pointer handling: one finger draws (drawer) / pans when zoomed (guessers); two fingers pinch-zoom
const wrap = $("cvwrap"), ptrs = new Map();
let cur = null, buf = [], flushT = null, shapeBase = null, zoom = 1, tx = 0, ty = 0, pinch = null, panStart = null;
function applyZoom() {
  const r = wrap.getBoundingClientRect();
  zoom = Math.max(1, Math.min(5, zoom)); tx = Math.min(0, Math.max(r.width * (1 - zoom), tx)); ty = Math.min(0, Math.max(r.height * (1 - zoom), ty));
  if (zoom <= 1.01) { zoom = 1; tx = 0; ty = 0; }
  cv.style.transform = zoom === 1 ? "" : `translate(${tx}px,${ty}px) scale(${zoom})`;
  $("zoomReset").classList.toggle("hide", zoom === 1);
}
$("zoomReset").onclick = () => { zoom = 1; applyZoom(); };
function normPos(e) { const r = cv.getBoundingClientRect(); return [Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))]; }
const canDraw = () => view.phase === "draw" && view.drawer === me;
function flush() { flushT = null; if (buf.length) { send({ t: "sp", p: buf }); buf = []; } }
const q4 = n => Math.round(n * 10000) / 10000;
function startStroke(e) {
  const [x, y] = normPos(e), c = tool === "eraser" ? "#ffffff" : color;
  if (tool === "fill") { const o = { k: "fill", c, w: 1, p: [q4(x), q4(y)] }; strokes.push(o); drawOp(o, 0); send({ t: "sb", o }); return; }
  if (tool === "shape") { cur = { k: shape, c, w: size, p: [q4(x), q4(y), q4(x), q4(y)] }; shapeBase = ctx.getImageData(0, 0, W, HH); return; }
  cur = { k: "pen", c, w: tool === "eraser" ? Math.max(size * 2, 16) : size, p: [q4(x), q4(y)] };
  strokes.push(cur); drawPen(cur, 0); send({ t: "sb", o: { ...cur, p: cur.p.slice() } });
}
function moveStroke(e) {
  if (!cur) return;
  if (cur.k !== "pen") { const [x, y] = normPos(e); cur.p[2] = q4(x); cur.p[3] = q4(y); ctx.putImageData(shapeBase, 0, 0); drawShape(cur); return; }
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e], from = cur.p.length;
  for (const ev of evs) {
    const [x, y] = normPos(ev), n = cur.p.length;
    if (Math.hypot((x - cur.p[n - 2]) * W, (y - cur.p[n - 1]) * HH) < 1.5) continue; // drop tiny moves
    cur.p.push(q4(x), q4(y)); buf.push(q4(x), q4(y));
  }
  if (cur.p.length > from) drawPen(cur, from);
  if (!flushT) flushT = setTimeout(flush, 40);
}
function endStroke(cancel) {
  if (!cur) return;
  if (cur.k !== "pen") {
    if (cancel) ctx.putImageData(shapeBase, 0, 0);
    else { strokes.push(cur); send({ t: "sb", o: cur }); }
    shapeBase = null;
  } else {
    flush(); penTail(cur);
    if (cancel && cur.p.length <= 8) { strokes.pop(); redraw(); send({ t: "undo" }); }
  }
  cur = null;
}
wrap.addEventListener("pointerdown", e => {
  e.preventDefault(); wrap.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e);
  if (ptrs.size === 2) {
    endStroke(true); panStart = null;
    const [a, b] = [...ptrs.values()], r = wrap.getBoundingClientRect();
    pinch = { d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx: (a.clientX + b.clientX) / 2 - r.left, my: (a.clientY + b.clientY) / 2 - r.top, z: zoom, tx, ty };
    return;
  }
  if (ptrs.size > 2) return;
  if (canDraw() && e.button !== 1) startStroke(e);
  else if (zoom > 1) panStart = { x: e.clientX, y: e.clientY, tx, ty };
});
wrap.addEventListener("pointermove", e => {
  if (!ptrs.has(e.pointerId)) return; ptrs.set(e.pointerId, e);
  if (pinch && ptrs.size >= 2) {
    const [a, b] = [...ptrs.values()], r = wrap.getBoundingClientRect();
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), mx = (a.clientX + b.clientX) / 2 - r.left, my = (a.clientY + b.clientY) / 2 - r.top;
    const nz = Math.max(1, Math.min(5, pinch.z * d / pinch.d)), px = (pinch.mx - pinch.tx) / pinch.z, py = (pinch.my - pinch.ty) / pinch.z;
    zoom = nz; tx = mx - px * nz; ty = my - py * nz; applyZoom(); return;
  }
  if (cur) moveStroke(e);
  else if (panStart) { tx = panStart.tx + e.clientX - panStart.x; ty = panStart.ty + e.clientY - panStart.y; applyZoom(); }
});
function ptrUp(e) { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) { endStroke(false); panStart = null; } }
wrap.addEventListener("pointerup", ptrUp); wrap.addEventListener("pointercancel", ptrUp);
wrap.addEventListener("wheel", e => { if (!e.ctrlKey && !e.metaKey) return; e.preventDefault(); const r = wrap.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top, px = (mx - tx) / zoom, py = (my - ty) / zoom; zoom *= e.deltaY < 0 ? 1.15 : 1 / 1.15; zoom = Math.max(1, Math.min(5, zoom)); tx = mx - px * zoom; ty = my - py * zoom; applyZoom(); }, { passive: false });

function buildTools() {
  const shapeIcon = { line: "／", rect: "▭", oval: "◯" }[shape];
  const tb = (label, on, fn, aria) => el("button", { className: "tb" + (on ? " on" : ""), type: "button", onclick: fn, "aria-label": aria }, label);
  $("tools").replaceChildren(
    el("button", { className: "tb colorbtn", type: "button", style: "background:" + color, onclick: colorSheet, "aria-label": "Color and size" }),
    tb(el("span", { className: "dot", style: `width:${Math.min(size, 24)}px;height:${Math.min(size, 24)}px` }), false, () => { size = SIZES[(SIZES.indexOf(size) + 1) % SIZES.length]; buildTools(); }, "Brush size"),
    tb("✏️", tool === "pen", () => { tool = "pen"; buildTools(); }, "Pen"),
    tb("🪣", tool === "fill", () => { tool = "fill"; buildTools(); }, "Fill"),
    tb(shapeIcon, tool === "shape", () => { if (tool === "shape") shape = { line: "rect", rect: "oval", oval: "line" }[shape]; tool = "shape"; buildTools(); }, "Shapes (tap again to switch)"),
    tb("🧽", tool === "eraser", () => { tool = "eraser"; buildTools(); }, "Eraser"),
    tb("↩️", false, () => { if (!strokes.length) return; strokes.pop(); redraw(); send({ t: "undo" }); }, "Undo"),
    tb("🗑️", false, () => { if (strokes.length && confirm("Clear the whole drawing?")) { strokes = []; redraw(); send({ t: "clear" }); } }, "Clear"));
}
function colorSheet() {
  const custom = el("input", { type: "color", value: color, style: "height:48px;padding:4px" });
  custom.addEventListener("input", () => { color = custom.value; if (tool === "eraser") tool = "pen"; buildTools(); });
  openSheet("Color & brush",
    el("div", { className: "palette" }, ...COLORS.map(c => el("button", { className: c === color ? "on" : "", style: "background:" + c, type: "button", "aria-label": c, onclick: () => { color = c; if (tool === "eraser") tool = "pen"; buildTools(); closeSheet(); } }))),
    el("label", {}, "Custom color", custom),
    el("div", { className: "sizes" }, ...SIZES.map(s => el("button", { className: s === size ? "on" : "", type: "button", onclick: () => { size = s; buildTools(); closeSheet(); } }, el("span", { className: "dot", style: `display:block;border-radius:50%;background:currentColor;width:${Math.min(s, 34)}px;height:${Math.min(s, 34)}px` })))),
    el("button", { className: "soft", onclick: closeSheet }, "Done"));
}

// ---------- end screen: gallery + confetti ----------
function thumb(item) { const c = document.createElement("canvas"); c.width = W; c.height = HH; renderAll(item.strokes, c.getContext("2d", { willReadFrequently: true })); return c; }
function galleryEl() {
  return el("div", { className: "gallery" }, ...gallery.map(g => {
    const c = thumb(g), img = el("img", { src: c.toDataURL("image/png"), alt: g.word });
    return el("figure", { onclick: () => saveDrawing(c, g) }, img, el("figcaption", {}, g.word + " · " + g.by));
  }));
}
function saveDrawing(c, g) {
  c.toBlob(async b => {
    const name = "doodle-" + g.word.replace(/\W+/g, "-") + ".png", file = new File([b], name, { type: "image/png" });
    try { if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: g.word }); return; } } catch (e) { if (e.name === "AbortError") return; }
    const a = el("a", { href: URL.createObjectURL(b), download: name }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }, "image/png");
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const c = $("confetti"), x = c.getContext("2d"); c.classList.remove("hide"); c.width = innerWidth; c.height = innerHeight;
  const ps = Array.from({ length: 160 }, () => ({ x: Math.random() * c.width, y: -20 - Math.random() * c.height * .5, vx: (Math.random() - .5) * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6, c: COLORS[4 + (Math.random() * 12 | 0)], s: 4 + Math.random() * 6 }));
  const t0 = performance.now();
  (function f(t) {
    x.clearRect(0, 0, c.width, c.height);
    for (const p of ps) { p.x += p.vx; p.y += p.vy; p.vy += .05; p.r += .1; x.save(); x.translate(p.x, p.y); x.rotate(p.r); x.fillStyle = p.c; x.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); x.restore(); }
    if (t - t0 < 4000) requestAnimationFrame(f); else c.classList.add("hide");
  })(t0);
}

// ---------- mobile keyboard handling ----------
function fitViewport() {
  const vv = window.visualViewport, h = vv ? vv.height : innerHeight;
  document.documentElement.style.setProperty("--app-h", h + "px");
  document.body.classList.toggle("kb", !!vv && vv.height < innerHeight * .78 && document.activeElement === $("msg"));
  if (document.body.classList.contains("ingame")) window.scrollTo(0, 0);
}
if (window.visualViewport) { visualViewport.addEventListener("resize", fitViewport); visualViewport.addEventListener("scroll", fitViewport); }
addEventListener("resize", fitViewport);
$("msg").addEventListener("focus", () => setTimeout(fitViewport, 300));
$("msg").addEventListener("blur", () => setTimeout(fitViewport, 100));

// ---------- PWA ----------
let deferredInstall = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; $("btnInstall").classList.remove("hide"); });
async function install() { if (!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; $("btnInstall").classList.add("hide"); }
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});

// ---------- home screen wiring ----------
function renderProfile() {
  $("avBig").textContent = profile.av; $("avBig").style.background = profile.col;
  $("avCols").replaceChildren(...AVCOLS.map(c => el("button", { type: "button", className: c === profile.col ? "on" : "", style: "background:" + c, "aria-label": "Avatar color", onclick: () => { profile.col = c; store.set("dd-profile", profile); renderProfile(); } })));
  $("avGrid").replaceChildren(...AVATARS.map(a => el("button", { type: "button", className: a === profile.av ? "on" : "", onclick: () => { profile.av = a; store.set("dd-profile", profile); renderProfile(); $("avGrid").classList.add("hide"); } }, a)));
}
$("avBig").onclick = () => $("avGrid").classList.toggle("hide");
$("name").value = profile.name || "";
renderProfile();
$("sendForm").addEventListener("submit", e => { e.preventDefault(); const v = $("msg").value.trim(); if (!v) return; send({ t: "guess", txt: v }); $("msg").value = ""; });
$("btnCreate").onclick = createRoom;
$("btnJoinCode").onclick = () => joinRoom($("code").value);
$("code").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom($("code").value); });
$("btnBrowse").onclick = () => { if (needName()) browseRooms(); };
$("btnInstall").onclick = install;
$("btnMute").onclick = () => { muted = !muted; store.set("dd-muted", muted); render(); if (!muted) sfx("ding"); };
$("btnShare").onclick = shareSheet;
$("btnMenu").onclick = menuSheet;
$("btnNotThis").onclick = () => { history.replaceState(null, "", location.pathname); $("joinBox").classList.add("hide"); $("hostBox").classList.remove("hide"); };
{ const f = store.get("dd-flash", null, true); if (f) { store.del("dd-flash", true); err(f); } }
const qr = (new URLSearchParams(location.search).get("r") || "").toUpperCase();
const session = store.get("dd-session", null, true);
if (qr && session && session.code === qr && profile.name) resumeSession(qr);
else if (qr) {
  $("joinBox").classList.remove("hide"); $("hostBox").classList.add("hide"); $("joinCode").textContent = qr;
  $("btnJoin").onclick = () => joinRoom(qr);
  $("name").addEventListener("keydown", e => { if (e.key === "Enter") joinRoom(qr); });
} else $("name").addEventListener("keydown", e => { if (e.key === "Enter") createRoom(); });
addEventListener("beforeunload", e => { if (isHost && H && active().length > 1 && !leaving) e.preventDefault(); });
