package main

import (
	"encoding/json"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

// ArenaHub owns all mutable game state. Every mutation happens on the Run
// goroutine; websocket read loops only push events into channels.
//
// Authority model: the client is authoritative for its own movement and for
// detecting hits of its own projectiles (this is a game for friends, no
// anti-cheat). The server owns HP, score, talents, NPCs and the round flow.
type ArenaHub struct {
	register   chan *client
	unregister chan *client
	joinEvt    chan joinEvent
	stateUpd   chan stateUpdate
	hitEvt     chan hitEvent
	castEvt    chan castEvent
	fireEvt    chan fireEvent
	pickEvt    chan pickEvent
	talentEvt  chan talentEvent
	readyEvt   chan readyEvent
	collectEvt chan collectEvent

	clients    map[uint64]*client
	collecting map[uint64]*collectState
	nextID     atomic.Uint64
	pickups    map[uint64]*pickup
	nextPickID atomic.Uint64
	lastPickup time.Time
	lastBuff   time.Time
	lastCoin   time.Time
	lastTick   time.Time
	respawnAt  map[uint64]int64
	auras      map[uint64]*playerAura
	projKinds  map[uint64]map[uint64]string
	npcs       map[uint64]*npcRuntime
	npcProjs   map[uint64]*npcProjectile
	nextNpcPID atomic.Uint64
	orbitals   map[uint64]*playerOrbit

	match   matchState
	records map[string]*playerRecord
}

func NewArenaHub() *ArenaHub {
	return &ArenaHub{
		register:   make(chan *client, 16),
		unregister: make(chan *client, 16),
		joinEvt:    make(chan joinEvent, 16),
		stateUpd:   make(chan stateUpdate, 1024),
		hitEvt:     make(chan hitEvent, 256),
		castEvt:    make(chan castEvent, 256),
		fireEvt:    make(chan fireEvent, 256),
		pickEvt:    make(chan pickEvent, 256),
		talentEvt:  make(chan talentEvent, 256),
		readyEvt:   make(chan readyEvent, 64),
		collectEvt: make(chan collectEvent, 256),
		clients:    make(map[uint64]*client),
		collecting: make(map[uint64]*collectState),
		pickups:    make(map[uint64]*pickup),
		lastTick:   time.Now(),
		respawnAt:  make(map[uint64]int64),
		auras:      make(map[uint64]*playerAura),
		projKinds:  make(map[uint64]map[uint64]string),
		npcs:       make(map[uint64]*npcRuntime),
		npcProjs:   make(map[uint64]*npcProjectile),
		orbitals:   make(map[uint64]*playerOrbit),
		match:      matchState{Phase: "idle", Week: 1, ScoreTarget: scoreTargetBase},
		records:    make(map[string]*playerRecord),
	}
}

func (h *ArenaHub) Run() {
	h.initNPCs()
	ticker := time.NewTicker(time.Second / tickRate)
	defer ticker.Stop()

	for {
		select {
		case c := <-h.register:
			h.clients[c.id] = c

		case c := <-h.unregister:
			if _, ok := h.clients[c.id]; ok {
				h.saveRecord(c)
				delete(h.clients, c.id)
				delete(h.auras, c.id)
				delete(h.projKinds, c.id)
				delete(h.orbitals, c.id)
				delete(h.respawnAt, c.id)
				delete(h.collecting, c.id)
				close(c.send)
				h.broadcastJSON(sMsg{Type: "leave", Data: sLeave{ID: c.id}})
			}

		case j := <-h.joinEvt:
			h.applyJoin(j)

		case u := <-h.stateUpd:
			if c, ok := h.clients[u.id]; ok {
				c.mu.Lock()
				if c.state.Alive {
					nowMS := time.Now().UnixMilli()
					if nowMS >= c.state.StunUntil {
						c.state.X = clamp(u.x, -mapHalfX, mapHalfX)
						c.state.Z = clamp(u.z, -mapHalfZ, mapHalfZ)
					}
					c.state.Facing = u.facing
				}
				c.mu.Unlock()
			}

		case ev := <-h.hitEvt:
			h.applyHit(ev)
		case ev := <-h.castEvt:
			h.applyCast(ev)
		case ev := <-h.fireEvt:
			h.applyFire(ev)
		case ev := <-h.pickEvt:
			h.applyPickup(ev)
		case ev := <-h.talentEvt:
			h.applyTalent(ev)
		case ev := <-h.readyEvt:
			h.applyReady(ev)
		case ev := <-h.collectEvt:
			h.applyCollect(ev)

		case <-ticker.C:
			now := time.Now()
			dt := now.Sub(h.lastTick).Seconds()
			if dt < 0 || dt > 1 {
				dt = 1.0 / float64(tickRate)
			}
			h.lastTick = now
			nowMS := now.UnixMilli()
			h.tickMatch(nowMS)
			h.processRespawns(nowMS)
			h.regen(dt)
			h.expirePickups(now)
			if h.match.Phase == "playing" || h.match.Phase == "warmup" {
				h.maybeSpawnPickup(now)
				h.maybeSpawnBuffPickup(now)
			}
			if h.match.Phase == "playing" {
				h.maybeSpawnCoin(now)
			}
			h.updateNPCs(now, dt)
			h.updateAuras(nowMS)
			h.updateOrbits(nowMS)
			h.updateNPCProjectiles(dt)
			h.updateCollects(nowMS)
			h.sendSnapshot()
		}
	}
}

func (h *ArenaHub) sendSnapshot() {
	now := time.Now().UnixMilli()
	players := make([]playerState, 0, len(h.clients))
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined {
			players = append(players, c.state)
		}
		c.mu.Unlock()
	}
	pks := make([]pickup, 0, len(h.pickups))
	for _, p := range h.pickups {
		pks = append(pks, *p)
	}
	npcs := make([]npcState, 0, len(h.npcs))
	for _, n := range h.npcs {
		npcs = append(npcs, n.state)
	}
	h.broadcastJSON(sMsg{Type: "snap", Data: sSnapshot{T: now, Players: players, Pickups: pks, Npcs: npcs, Match: h.match}})
}

func (h *ArenaHub) broadcastJSON(m sMsg) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	for _, c := range h.clients {
		select {
		case c.send <- b:
		default:
			// drop a slow client's message rather than block the hub
		}
	}
}

func (h *ArenaHub) sendTo(c *client, m sMsg) {
	b, err := json.Marshal(m)
	if err != nil {
		return
	}
	select {
	case c.send <- b:
	default:
	}
}

// ------------------------------------------------------------ websocket

// buildID identifies this server process; clients that reconnect to a
// different one reload so they never run stale scripts.
var buildID = time.Now().UnixMilli()

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin:     func(r *http.Request) bool { return true },
}

func (h *ArenaHub) ServeWS(w http.ResponseWriter, r *http.Request) {
	if len(h.clients) >= maxPlayers {
		http.Error(w, "lobby full", http.StatusServiceUnavailable)
		return
	}
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("upgrade: %v", err)
		return
	}

	id := h.nextID.Add(1)
	c := &client{
		id:   id,
		hub:  h,
		conn: conn,
		send: make(chan []byte, sendQueueLen),
		state: playerState{
			ID:      id,
			Name:    "player",
			HP:      startHP,
			Mana:    startMana,
			MaxHP:   startHP,
			MaxMana: startMana,
			Alive:   true,
			InvulnT: time.Now().UnixMilli() + spawnInvulnMS,
		},
	}
	c.derived = deriveStats(nil)
	c.state.X, c.state.Z = pickSpawn(nil)

	// Welcome carries everything static: map, talent tree, current match.
	welcome := sMsg{Type: "welcome", Data: sWelcome{
		Build: buildID, YouID: id, TickRate: tickRate,
		StartHP: startHP, StartMana: startMana, NowMS: time.Now().UnixMilli(),
		Map: arena, Talents: talentTree, Match: h.match, RespawnMS: respawnMS,
	}}
	if b, err := json.Marshal(welcome); err == nil {
		_ = conn.WriteMessage(websocket.TextMessage, b)
	}

	h.register <- c
	go c.writeLoop()
	go c.readLoop()
}

func (c *client) writeLoop() {
	pingT := time.NewTicker(30 * time.Second)
	defer pingT.Stop()
	defer c.conn.Close()
	for {
		select {
		case msg, ok := <-c.send:
			if !ok {
				_ = c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-pingT.C:
			_ = c.conn.SetWriteDeadline(time.Now().Add(5 * time.Second))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *client) readLoop() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(8 * 1024)
	_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	c.conn.SetPongHandler(func(string) error {
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			return
		}
		_ = c.conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		var m cMsg
		if err := json.Unmarshal(raw, &m); err != nil {
			continue
		}
		switch m.Type {
		case "join":
			var j cJoin
			if err := json.Unmarshal(m.Data, &j); err != nil {
				continue
			}
			c.hub.joinEvt <- joinEvent{c: c, name: sanitizeName(j.Name), model: sanitizeModel(j.Model)}

		case "state":
			var s cState
			if err := json.Unmarshal(m.Data, &s); err != nil {
				continue
			}
			select {
			case c.hub.stateUpd <- stateUpdate{id: c.id, x: s.X, z: s.Z, facing: s.Facing}:
			default:
			}

		case "fire":
			var f cFire
			if err := json.Unmarshal(m.Data, &f); err != nil {
				continue
			}
			select {
			case c.hub.fireEvt <- fireEvent{shooter: c.id, pid: f.PID, ox: f.OX, oz: f.OZ, dx: f.DX, dz: f.DZ, kind: f.Kind}:
			default:
			}

		case "cast":
			var cc cCast
			if err := json.Unmarshal(m.Data, &cc); err != nil {
				continue
			}
			ev := castEvent{id: c.id, kind: cc.Kind}
			if cc.X != nil && cc.Z != nil {
				ev.hasPos = true
				ev.x = *cc.X
				ev.z = *cc.Z
			}
			select {
			case c.hub.castEvt <- ev:
			default:
			}

		case "pickup":
			var pk cPickup
			if err := json.Unmarshal(m.Data, &pk); err != nil {
				continue
			}
			select {
			case c.hub.pickEvt <- pickEvent{player: c.id, pickup: pk.ID}:
			default:
			}

		case "talent":
			var t cTalent
			if err := json.Unmarshal(m.Data, &t); err != nil {
				continue
			}
			select {
			case c.hub.talentEvt <- talentEvent{player: c.id, id: t.ID}:
			default:
			}

		case "collect":
			var cc cCollect
			if err := json.Unmarshal(m.Data, &cc); err != nil {
				continue
			}
			select {
			case c.hub.collectEvt <- collectEvent{player: c.id, pickup: cc.ID, start: cc.Start}:
			default:
			}

		case "ready":
			var r cReady
			if err := json.Unmarshal(m.Data, &r); err != nil {
				continue
			}
			select {
			case c.hub.readyEvt <- readyEvent{player: c.id, ready: r.Ready}:
			default:
			}

		case "hit":
			var hh cHit
			if err := json.Unmarshal(m.Data, &hh); err != nil {
				continue
			}
			if hh.Target == c.id {
				continue
			}
			select {
			case c.hub.hitEvt <- hitEvent{shooter: c.id, target: hh.Target, pid: hh.PID, dmg: hh.Dmg}:
			default:
			}
		}
	}
}

func sanitizeName(s string) string {
	out := make([]rune, 0, maxNameLen)
	for _, r := range s {
		if r < 32 || r == 127 {
			continue
		}
		out = append(out, r)
		if len(out) >= maxNameLen {
			break
		}
	}
	if len(out) == 0 {
		return "player"
	}
	return string(out)
}

func sanitizeModel(m int) int {
	if m < 0 || m > 3 {
		return 0
	}
	return m
}
