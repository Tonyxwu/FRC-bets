const path = require("path");
const fs = require("fs");

function loadEnvFile(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    raw.split("\n").forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#")) {
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const key = trimmed.slice(0, eq).trim();
          let val = trimmed.slice(eq + 1).trim();
          if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
          if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
          process.env[key] = val;
        }
      }
    });
  } catch (e) {
    if (e.code !== "ENOENT") console.error("loadEnvFile:", e.message);
  }
}

loadEnvFile(path.join(__dirname, ".env"));
if (!process.env.TBA_KEY) loadEnvFile(path.join(__dirname, "envVars.env"));

const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();
const TBA_KEY = process.env.TBA_KEY || "";
if (!TBA_KEY) {
  console.error("TBA_KEY is not set. Copy .env.example to .env and set TBA_KEY (or set it in envVars.env).");
  process.exit(1);
}
const DEFAULT_EVENT = "2025txdal";
const DEFAULT_BALANCE = 100;
const STORE_PATH = path.join(__dirname, "data", "store.json");

// --- Virtual time (simulation) for multiplayer testing ---
// Set VIRTUAL_START_TIME (ISO e.g. 2025-02-20T08:00:00) to run sim; time ticks VIRTUAL_SPEED x real time (default 10).
const VIRTUAL_START_TIME_RAW = process.env.VIRTUAL_START_TIME || "";
const VIRTUAL_SPEED = Math.max(1, parseInt(process.env.VIRTUAL_SPEED || "10", 10));
const serverStartRealMs = Date.now();
let virtualStartUnix = null;
if (VIRTUAL_START_TIME_RAW) {
  const d = new Date(VIRTUAL_START_TIME_RAW.trim());
  if (!isNaN(d.getTime())) {
    virtualStartUnix = Math.floor(d.getTime() / 1000);
    console.log("Simulation mode: virtual time started at", new Date(virtualStartUnix * 1000).toISOString(), "speed", VIRTUAL_SPEED + "x");
  }
}
function getVirtualTime() {
  if (virtualStartUnix == null) return null;
  const realElapsedSec = (Date.now() - serverStartRealMs) / 1000;
  const virtualNowUnix = virtualStartUnix + realElapsedSec * VIRTUAL_SPEED;
  return { virtualUnix: Math.floor(virtualNowUnix), virtualTime: new Date(virtualNowUnix * 1000).toISOString(), speedFactor: VIRTUAL_SPEED };
}

// In sim mode: pretend matches didn't happen — hide scores so UI shows "Open for bets" and we can bet without seeing red/blue win
function maskMatchIfSim(match) {
  if (!match) return match;
  if (!getVirtualTime()) return match;
  const out = JSON.parse(JSON.stringify(match));
  if (out.alliances?.red) out.alliances.red.score = null;
  if (out.alliances?.blue) out.alliances.blue.score = null;
  return out;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// --- Persistence: load store ---
function loadStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    const data = JSON.parse(raw);
    const users = new Map(Object.entries(data.users || {}));
    const nextUserId = data.nextUserId || 1;
    const markets = new Map();
    for (const [k, v] of Object.entries(data.markets || {})) {
      markets.set(k, v);
    }
    const bets = Array.isArray(data.bets) ? data.bets : [];
    const marketTotals = typeof data.marketTotals === "object" && data.marketTotals !== null ? data.marketTotals : {};
    const sessions = new Map(Object.entries(data.sessions || {}));
    return { users, nextUserId, markets, bets, marketTotals, sessions };
  } catch (e) {
    if (e.code !== "ENOENT") console.error("Load store:", e.message);
    return null;
  }
}

function saveStore() {
  const data = {
    users: Object.fromEntries(users),
    nextUserId,
    markets: Object.fromEntries(markets),
    bets,
    marketTotals,
    sessions: Object.fromEntries(sessions),
  };
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (e) {
    console.error("Save store:", e.message);
  }
}

let loaded = loadStore();
const users = loaded ? loaded.users : new Map();
let nextUserId = loaded ? loaded.nextUserId : 1;
const markets = loaded ? loaded.markets : new Map();
let bets = loaded ? loaded.bets : [];
let marketTotals = loaded ? loaded.marketTotals : {};
const sessions = loaded ? loaded.sessions : new Map();

const RESET_BALANCES_AND_BETS = /^(1|true|yes)$/i.test(String(process.env.RESET_BALANCES_AND_BETS || "").trim());
if (RESET_BALANCES_AND_BETS) {
  users.forEach((u) => { u.balance = DEFAULT_BALANCE; });
  bets = [];
  marketTotals = {};
  markets.forEach((m) => { m.resolved = null; m.winner = null; });
  const data = {
    users: Object.fromEntries(users),
    nextUserId,
    markets: Object.fromEntries(markets),
    bets,
    marketTotals,
    sessions: Object.fromEntries(sessions),
  };
  try {
    fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2), "utf8");
    console.log("RESET_BALANCES_AND_BETS=true: all balances set to $" + DEFAULT_BALANCE + ", all bets and pool totals cleared, markets reopened.");
  } catch (e) {
    console.error("Reset save failed:", e.message);
  }
}

function hashPassword(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function createToken() {
  return crypto.randomBytes(24).toString("hex");
}

function getUserId(req) {
  const auth = req.headers.authorization || req.headers["x-session"];
  const token = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice(7) : auth;
  if (!token) return null;
  return sessions.get(token) || null;
}

function requireAuth(req, res, next) {
  const userId = getUserId(req);
  if (!userId) return res.status(401).json({ error: "Not logged in" });
  req.userId = userId;
  next();
}

function normalizeTeamNumber(v) {
  if (v == null || v === "") return null;
  const s = String(v).trim();
  const num = parseInt(s, 10);
  if (!isNaN(num) && num > 0) return String(num);
  if (/^\d+$/.test(s)) return s;
  return null;
}

app.post("/api/signup", (req, res) => {
  const { username, password, teamNumber } = req.body || {};
  if (!username || !password || typeof username !== "string" || typeof password !== "string") {
    return res.status(400).json({ error: "Username and password required" });
  }
  const u = username.trim().toLowerCase();
  if (u.length < 2) return res.status(400).json({ error: "Username too short" });
  if (password.length < 4) return res.status(400).json({ error: "Password must be at least 4 characters" });
  const team = normalizeTeamNumber(teamNumber);
  if (!team) return res.status(400).json({ error: "Team number is required (e.g. 1418)" });
  const existing = Array.from(users.values()).find((x) => x.username === u);
  if (existing) return res.status(400).json({ error: "Username already taken" });
  const userId = String(nextUserId++);
  users.set(userId, {
    username: u,
    passwordHash: hashPassword(password),
    balance: DEFAULT_BALANCE,
    teamNumber: team,
  });
  const token = createToken();
  sessions.set(token, userId);
  const user = users.get(userId);
  saveStore();
  res.json({ token, user: { id: userId, username: user.username, balance: user.balance, teamNumber: user.teamNumber || null } });
});

app.post("/api/login", (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const u = (username + "").trim().toLowerCase();
  const entry = Array.from(users.entries()).find(([, x]) => x.username === u);
  if (!entry) return res.status(401).json({ error: "Invalid username or password" });
  const [userId, user] = entry;
  if (user.passwordHash !== hashPassword(password)) return res.status(401).json({ error: "Invalid username or password" });
  const token = createToken();
  sessions.set(token, userId);
  saveStore();
  res.json({ token, user: { id: userId, username: user.username, balance: user.balance, teamNumber: user.teamNumber || null } });
});

app.get("/api/me", requireAuth, (req, res) => {
  const user = users.get(req.userId);
  if (!user) return res.status(401).json({ error: "Not found" });
  res.json({ user: { id: req.userId, username: user.username, balance: user.balance, teamNumber: user.teamNumber || null } });
});

app.get("/api/sim/time", (req, res) => {
  const sim = getVirtualTime();
  if (!sim) return res.json({ enabled: false, realUnix: Math.floor(Date.now() / 1000) });
  res.json({ enabled: true, ...sim, realUnix: Math.floor(Date.now() / 1000) });
});

app.get("/api/leaderboard", (req, res) => {
  const teamFilter = normalizeTeamNumber(req.query.team);
  let list = Array.from(users.entries())
    .filter(([, u]) => u && (u.username != null || u.balance != null))
    .map(([id, u]) => ({
      id,
      username: u.username || "?",
      balance: typeof u.balance === "number" ? u.balance : 0,
      teamNumber: u.teamNumber != null && u.teamNumber !== "" ? String(u.teamNumber) : null,
    }));
  if (teamFilter) list = list.filter((u) => u.teamNumber === teamFilter);
  list.sort((a, b) => b.balance - a.balance);
  const ranked = list.map((u, i) => ({ id: u.id, rank: i + 1, username: u.username, balance: u.balance, teamNumber: u.teamNumber }));
  res.json({ list: ranked, filter: teamFilter ? "team" : "all", team: teamFilter });
});

app.get("/api/bets", requireAuth, async (req, res) => {
  const userId = req.userId;
  const myBets = bets.filter((b) => b.userId === userId);
  const marketIds = [...new Set(myBets.map((b) => b.marketId))];
  for (const marketId of marketIds) {
    await tryResolveMarket(marketId, {});
  }
  const byMarket = {};
  myBets.forEach((b) => {
    if (!byMarket[b.marketId]) {
      byMarket[b.marketId] = { marketId: b.marketId, red: 0, blue: 0, bets: [] };
      const tot = marketTotals[b.marketId];
      if (tot) {
        byMarket[b.marketId].totalRed = tot.totalRed || 0;
        byMarket[b.marketId].totalBlue = tot.totalBlue || 0;
      }
      const m = markets.get(b.marketId);
      if (m) {
        byMarket[b.marketId].resolved = m.resolved;
        byMarket[b.marketId].winner = m.winner;
        byMarket[b.marketId].question = m.question;
      }
    }
    byMarket[b.marketId][b.side] += b.amount;
    byMarket[b.marketId].bets.push({ side: b.side, amount: b.amount, timestamp: b.timestamp });
  });
  const positions = Object.values(byMarket).map((p) => {
    const out = { ...p };
    if (p.resolved !== null && p.totalRed != null && p.totalBlue != null) {
      const staked = (p.red || 0) + (p.blue || 0);
      const pool = p.totalRed + p.totalBlue;
      let payout = 0;
      if (p.winner === "tie") {
        payout = staked;
      } else if (p.winner === "red" && p.totalRed > 0) {
        payout = ((p.red || 0) / p.totalRed) * pool;
      } else if (p.winner === "blue" && p.totalBlue > 0) {
        payout = ((p.blue || 0) / p.totalBlue) * pool;
      }
      out.payout = payout;
      out.profit = payout - staked;
    }
    return out;
  });
  const user = users.get(userId);
  const balance = user && typeof user.balance === "number" ? user.balance : null;
  res.json({ positions, orderHistory: myBets, balance });
});

async function tba(path) {
  const { data } = await axios.get(`https://www.thebluealliance.com/api/v3${path}`, {
    headers: { "X-TBA-Auth-Key": TBA_KEY },
  });
  return data;
}

app.get("/api/event/:eventKey", async (req, res) => {
  try {
    const event = await tba(`/event/${req.params.eventKey}`);
    res.json(event);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching event" });
  }
});

app.get("/api/events/upcoming", async (req, res) => {
  try {
    const sim = getVirtualTime();
    const nowMs = sim ? sim.virtualUnix * 1000 : Date.now();
    const now = new Date(nowMs);
    const today = now.toISOString().slice(0, 10);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 7);
    const endStr = nextWeek.toISOString().slice(0, 10);
    const year = now.getFullYear();
    const events = await tba(`/events/${year}`);
    const nextYearEvents = year !== nextWeek.getFullYear() ? await tba(`/events/${year + 1}`) : [];
    const all = [...events, ...nextYearEvents];
    const filtered = all
      .filter((e) => e.start_date >= today && e.start_date <= endStr)
      .sort((a, b) => a.start_date.localeCompare(b.start_date));
    const upcoming = await Promise.all(
      filtered.map(async (e) => {
        let hasOpenMatches = false;
        try {
          const matches = await tba(`/event/${e.key}/matches`);
          if (Array.isArray(matches) && matches.length > 0) {
            hasOpenMatches = matches.some(
              (m) =>
                m.alliances?.red?.score == null || m.alliances?.blue?.score == null
            );
          }
        } catch (_) {}
        return {
          key: e.key,
          name: e.name,
          short_name: e.short_name || e.name,
          start_date: e.start_date,
          end_date: e.end_date,
          city: e.city,
          state_prov: e.state_prov,
          has_open_matches: hasOpenMatches,
        };
      })
    );
    res.json(upcoming);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching upcoming events" });
  }
});

app.get("/event/matches/:eventKey", async (req, res) => {
  try {
    const matches = await tba(`/event/${req.params.eventKey}/matches`);
    res.json(matches);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching matches" });
  }
});

app.get("/event/match/:matchKey", async (req, res) => {
  try {
    const match = await tba(`/match/${req.params.matchKey}`);
    res.json(match);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching match" });
  }
});

app.get("/api/matches", async (req, res) => {
  const eventKey = req.query.eventKey || DEFAULT_EVENT;
  try {
    const matches = await tba(`/event/${eventKey}/matches`);
    const masked = Array.isArray(matches) ? matches.map((m) => maskMatchIfSim(m)) : matches;
    res.json(masked);
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching matches" });
  }
});

app.get("/api/match/:matchKey", async (req, res) => {
  try {
    const match = await tba(`/match/${req.params.matchKey}`);
    res.json(maskMatchIfSim(match));
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Error fetching match" });
  }
});

// --- Pool-based betting: all money in pool, winner side splits total proportionally ---
function ensureMarket(matchKey) {
  if (!markets.has(matchKey)) {
    markets.set(matchKey, {
      matchKey,
      question: "Will Red Alliance win?",
      resolved: null,
      winner: null,
    });
    if (!marketTotals[matchKey]) marketTotals[matchKey] = { totalRed: 0, totalBlue: 0 };
  }
  return markets.get(matchKey);
}

app.get("/api/markets", (req, res) => {
  const sim = getVirtualTime();
  const list = Array.from(markets.entries()).map(([id, m]) => {
    const tot = marketTotals[id] || { totalRed: 0, totalBlue: 0 };
    const resolved = sim ? null : m.resolved;
    const winner = sim ? null : m.winner;
    return { marketId: id, question: m.question, resolved, winner, totalRed: tot.totalRed, totalBlue: tot.totalBlue };
  });
  res.json(list);
});

async function tryResolveMarket(marketId, opts = {}) {
  const market = markets.get(marketId);
  if (!market || market.resolved !== null) return;
  try {
    const match = await tba(`/match/${marketId}`);
    const sim = getVirtualTime();
    if (sim && (match.time == null || match.time > sim.virtualUnix)) return;
    const red = match.alliances?.red?.score;
    const blue = match.alliances?.blue?.score;
    if (red == null || blue == null) return;
    market.resolved = true;
    market.winner = red > blue ? "red" : blue > red ? "blue" : "tie";
    const tot = marketTotals[marketId] || { totalRed: 0, totalBlue: 0 };
    const totalPool = tot.totalRed + tot.totalBlue;
    const marketBets = bets.filter((b) => b.marketId === marketId);
    if (market.winner === "tie") {
      marketBets.forEach((b) => {
        const user = users.get(b.userId);
        if (user) user.balance += b.amount;
      });
    } else {
      const winningTotal = market.winner === "red" ? tot.totalRed : tot.totalBlue;
      if (winningTotal > 0) {
        marketBets.filter((b) => b.side === market.winner).forEach((b) => {
          const user = users.get(b.userId);
          if (user) user.balance += (b.amount / winningTotal) * totalPool;
        });
      }
    }
    saveStore();
  } catch (_) {}
}

app.get("/api/markets/:marketId", async (req, res) => {
  const marketId = req.params.marketId;
  const m = markets.get(marketId);
  if (!m) return res.status(404).json({ error: "Market not found" });
  await tryResolveMarket(marketId, {});
  const market = markets.get(marketId);
  const tot = marketTotals[market.matchKey] || { totalRed: 0, totalBlue: 0 };
  const payload = { ...market, totalRed: tot.totalRed, totalBlue: tot.totalBlue };
  if (getVirtualTime()) { payload.resolved = null; payload.winner = null; }
  res.json(payload);
});

app.post("/api/markets", (req, res) => {
  const { matchKey } = req.body || {};
  if (!matchKey) return res.status(400).json({ error: "matchKey required" });
  const market = ensureMarket(matchKey);
  res.json({ marketId: market.matchKey, question: market.question });
});

function parseSimDateTimeToUnix(simStr) {
  if (typeof simStr !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(simStr)) return null;
  const s = simStr.slice(0, 16).replace("T", " ");
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

app.post("/api/markets/:marketId/order", requireAuth, async (req, res) => {
  const marketId = req.params.marketId;
  const userId = req.userId;
  const { side, amount, simDateTime } = req.body || {};
  const simDtHeader = req.headers["x-sim-datetime"];
  const simStr = simDateTime || simDtHeader;
  // When global sim is on, use server virtual time for everyone; otherwise allow client-provided sim time
  const globalSim = getVirtualTime();
  const simUnix = globalSim
    ? globalSim.virtualUnix
    : parseSimDateTimeToUnix(simStr);

  if (!["red", "blue"].includes(side) || typeof amount !== "number" || amount <= 0) {
    return res.status(400).json({ error: "Invalid side (red|blue) or amount (positive dollars)" });
  }
  const market = ensureMarket(marketId);
  if (market.resolved !== null) return res.status(400).json({ error: "Market already resolved" });
  try {
    const match = await tba(`/match/${marketId}`);
    const matchTime = match.time != null ? match.time : null;
    const red = match.alliances?.red?.score;
    const blue = match.alliances?.blue?.score;
    const hasScores = red != null && blue != null;

    if (simUnix != null) {
      if (matchTime == null) return res.status(400).json({ error: "Match has no scheduled time" });
      if (matchTime <= simUnix) return res.status(400).json({ error: "Match is not in the future relative to your simulated time" });
    } else {
      if (hasScores) return res.status(400).json({ error: "Match already finished; no more bets" });
    }
  } catch (e) {
    return res.status(400).json({ error: "Match not found or not ongoing" });
  }
  const user = users.get(userId);
  if (user.balance < amount) return res.status(400).json({ error: "Insufficient balance", balance: user.balance });
  user.balance -= amount;
  if (!marketTotals[marketId]) marketTotals[marketId] = { totalRed: 0, totalBlue: 0 };
  if (side === "red") marketTotals[marketId].totalRed += amount;
  else marketTotals[marketId].totalBlue += amount;
  bets.push({ userId, marketId, side, amount, timestamp: new Date().toISOString() });
  const myRed = bets.filter((b) => b.userId === userId && b.marketId === marketId && b.side === "red").reduce((s, b) => s + b.amount, 0);
  const myBlue = bets.filter((b) => b.userId === userId && b.marketId === marketId && b.side === "blue").reduce((s, b) => s + b.amount, 0);
  saveStore();
  res.json({
    balance: user.balance,
    pool: { totalRed: marketTotals[marketId].totalRed, totalBlue: marketTotals[marketId].totalBlue },
    yourBets: { red: myRed, blue: myBlue },
  });
});

app.get("/api/markets/:marketId/position", (req, res) => {
  const userId = getUserId(req);
  const marketId = req.params.marketId;
  let red = 0, blue = 0;
  if (userId) {
    bets.filter((b) => b.userId === userId && b.marketId === marketId).forEach((b) => {
      if (b.side === "red") red += b.amount; else blue += b.amount;
    });
  }
  const tot = marketTotals[marketId] || { totalRed: 0, totalBlue: 0 };
  res.json({ red, blue, totalRed: tot.totalRed, totalBlue: tot.totalBlue });
});

// Resolution is automatic when the market is fetched and TBA has scores (no user action).
app.listen(process.env.PORT || 3000, () => {
  console.log("Server running on http://localhost:3000");
  if (virtualStartUnix != null) {
    console.log("Simulation: set VIRTUAL_START_TIME (e.g. 2025-02-20T08:00:00) and optional VIRTUAL_SPEED (default 10) to test multiplayer betting in fast-forward.");
  } else {
    console.log("To enable simulation mode: VIRTUAL_START_TIME=2025-02-20T08:00:00 [VIRTUAL_SPEED=10] node server.js");
  }
});