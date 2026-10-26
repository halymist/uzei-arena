package main

import (
	"sort"
	"strings"
	"time"
)

// Match flow: a work week of five days. Every day is one round; the day's
// winner earns a Home Office day. Between days players spend talent points.
// After Friday the player with the most Home Office days wins the week and
// everything resets.

var dayNames = []string{"Pondělí", "Úterý", "Středa", "Čtvrtek", "Pátek"}

func (h *ArenaHub) joinedCount() int {
	n := 0
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined {
			n++
		}
		c.mu.Unlock()
	}
	return n
}

// daysCompleted is how many rounds already finished this week.
func (h *ArenaHub) daysCompleted() int {
	switch h.match.Phase {
	case "intermission":
		return h.match.Day + 1
	case "weekend":
		return daysPerWeek
	default:
		return h.match.Day
	}
}

func recordKey(name string) string { return strings.ToLower(strings.TrimSpace(name)) }

func (h *ArenaHub) saveRecord(c *client) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.joined {
		return
	}
	h.records[recordKey(c.state.Name)] = &playerRecord{
		Talents:   append([]string(nil), c.state.Talents...),
		TalentPts: c.state.TalentPts,
		HODays:    c.state.HODays,
		WeekScore: c.state.WeekScore,
	}
}

func (h *ArenaHub) applyJoin(j joinEvent) {
	c := j.c
	if _, ok := h.clients[c.id]; !ok {
		return
	}
	nowMS := time.Now().UnixMilli()
	c.mu.Lock()
	c.state.Name = j.name
	c.state.Model = j.model
	c.joined = true
	if rec, ok := h.records[recordKey(j.name)]; ok {
		c.state.Talents = append([]string(nil), rec.Talents...)
		c.state.TalentPts = rec.TalentPts
		c.state.HODays = rec.HODays
		c.state.WeekScore = rec.WeekScore
	} else {
		// late joiner catch-up: the same base points everyone else received
		c.state.TalentPts = h.daysCompleted() * talentPtsPerDay
	}
	c.derived = deriveStats(c.state.Talents)
	h.recomputePlayerDerivedStatsLocked(c, nowMS)
	c.state.HP = c.state.MaxHP
	c.state.Mana = c.state.MaxMana
	c.state.Alive = true
	c.state.InvulnT = nowMS + spawnInvulnMS
	c.mu.Unlock()
	c.state.X, c.state.Z = pickSpawn(h.enemyPositions(c.id))
}

func (h *ArenaHub) enemyPositions(except uint64) [][2]float64 {
	out := make([][2]float64, 0, len(h.clients))
	for id, o := range h.clients {
		if id == except {
			continue
		}
		o.mu.Lock()
		if o.joined && o.state.Alive {
			out = append(out, [2]float64{o.state.X, o.state.Z})
		}
		o.mu.Unlock()
	}
	return out
}

// ------------------------------------------------------------ phases

func (h *ArenaHub) tickMatch(nowMS int64) {
	players := h.joinedCount()
	if players == 0 {
		if h.match.Phase != "idle" {
			h.resetWeek()
			h.match.Phase = "idle"
			h.match.PhaseEndsAt = 0
		}
		return
	}

	switch h.match.Phase {
	case "idle":
		h.startWarmup(nowMS, true)

	case "warmup":
		if nowMS >= h.match.PhaseEndsAt {
			h.startRound(nowMS)
		}

	case "playing":
		h.computeLeader()
		if nowMS >= h.match.PhaseEndsAt {
			h.endRound(nowMS, "time")
		}

	case "intermission":
		// the break lasts until everyone pressed ready (plus a short grace)
		if h.breakOver(nowMS) {
			if h.match.Day >= daysPerWeek-1 {
				h.startWeekend(nowMS)
			} else {
				h.match.Day++
				h.startWarmup(nowMS, false)
			}
		}

	case "weekend":
		if h.breakOver(nowMS) {
			h.resetWeek()
			h.match.Week++
			h.startWarmup(nowMS, true)
		}
	}
}

// breakOver drives PhaseEndsAt during breaks: 0 while someone is not ready,
// a short countdown once everyone is.
func (h *ArenaHub) breakOver(nowMS int64) bool {
	if !h.allReady() {
		h.match.PhaseEndsAt = 0
		return false
	}
	if h.match.PhaseEndsAt == 0 {
		h.match.PhaseEndsAt = nowMS + allReadyGraceMS
		return false
	}
	return nowMS >= h.match.PhaseEndsAt
}

func (h *ArenaHub) allReady() bool {
	any := false
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined {
			any = true
			if !c.state.Ready {
				c.mu.Unlock()
				return false
			}
		}
		c.mu.Unlock()
	}
	return any
}

func (h *ArenaHub) startWarmup(nowMS int64, first bool) {
	dur := warmupDuration(warmupMS)
	if first {
		dur = warmupDuration(firstWarmupMS)
	}
	h.match.Phase = "warmup"
	h.match.PhaseEndsAt = nowMS + dur
	h.match.LeaderID = 0
	h.match.ScoreTarget = h.scoreTargetFor(h.joinedCount())
	h.clearWorld()
	h.resetPlayersForRound(nowMS)
	h.initNPCs()
	h.broadcastJSON(sMsg{Type: "round", Data: sRound{Match: h.match, T: nowMS}})
}

func (h *ArenaHub) scoreTargetFor(players int) int {
	switch {
	case players >= 6:
		return scoreTargetBase + 5
	case players >= 4:
		return scoreTargetBase + 2
	default:
		return scoreTargetBase
	}
}

func (h *ArenaHub) startRound(nowMS int64) {
	h.match.Phase = "playing"
	h.match.PhaseEndsAt = nowMS + phaseDuration(roundMS)
	h.match.LeaderID = 0
	h.match.ScoreTarget = h.scoreTargetFor(h.joinedCount())
	h.clearWorld()
	h.resetPlayersForRound(nowMS)
	h.broadcastJSON(sMsg{Type: "round", Data: sRound{Match: h.match, T: nowMS}})
}

func (h *ArenaHub) endRound(nowMS int64, reason string) {
	st := h.standings()
	winner := uint64(0)
	if len(st) > 0 && st[0].Score > 0 && (len(st) == 1 || st[0].Score > st[1].Score) {
		winner = st[0].ID
	}
	n := len(st)
	for i := range st {
		pts := talentPtsPerDay
		if n >= 2 && i >= (n+1)/2 {
			pts += talentPtsCatchUp
		}
		st[i].PtsAward = pts
		c := h.clients[st[i].ID]
		if c == nil {
			continue
		}
		c.mu.Lock()
		c.state.TalentPts += pts
		c.state.WeekScore += c.state.Score
		if c.id == winner {
			c.state.HODays++
		}
		c.state.Ready = false
		st[i].HODays = c.state.HODays
		st[i].WeekScore = c.state.WeekScore
		c.mu.Unlock()
		h.saveRecord(c)
	}
	h.match.Phase = "intermission"
	h.match.PhaseEndsAt = 0 // waits for everyone to be ready
	h.match.LastWinnerID = winner
	h.match.LeaderID = 0
	h.clearWorld()
	h.broadcastJSON(sMsg{Type: "round", Data: sRound{Match: h.match, Standings: st, WinnerID: winner, Reason: reason, T: nowMS}})
}

func (h *ArenaHub) startWeekend(nowMS int64) {
	st := h.standings()
	sort.SliceStable(st, func(i, j int) bool {
		if st[i].HODays != st[j].HODays {
			return st[i].HODays > st[j].HODays
		}
		return st[i].WeekScore > st[j].WeekScore
	})
	winner := uint64(0)
	if len(st) > 0 && st[0].HODays > 0 {
		winner = st[0].ID
	}
	for _, c := range h.clients {
		c.mu.Lock()
		c.state.Ready = false
		c.mu.Unlock()
	}
	h.match.Phase = "weekend"
	h.match.PhaseEndsAt = 0 // waits for everyone to be ready
	h.match.WeekWinnerID = winner
	h.broadcastJSON(sMsg{Type: "round", Data: sRound{Match: h.match, Standings: st, WinnerID: winner, Reason: "week", T: nowMS}})
}

func (h *ArenaHub) resetWeek() {
	h.match.Day = 0
	h.match.LeaderID = 0
	h.match.LastWinnerID = 0
	h.match.WeekWinnerID = 0
	h.records = make(map[string]*playerRecord)
	for _, c := range h.clients {
		c.mu.Lock()
		c.state.Talents = nil
		c.state.TalentPts = 0
		c.state.HODays = 0
		c.state.WeekScore = 0
		c.state.Score = 0
		c.state.Kills = 0
		c.state.Deaths = 0
		c.state.Ready = false
		c.derived = deriveStats(nil)
		h.recomputePlayerDerivedStatsLocked(c, time.Now().UnixMilli())
		c.mu.Unlock()
	}
}

// clearWorld removes everything transient: pickups, auras, orbits, NPC shots.
func (h *ArenaHub) clearWorld() {
	h.pickups = make(map[uint64]*pickup)
	h.auras = make(map[uint64]*playerAura)
	h.orbitals = make(map[uint64]*playerOrbit)
	h.npcProjs = make(map[uint64]*npcProjectile)
	h.projKinds = make(map[uint64]map[uint64]string)
	h.respawnAt = make(map[uint64]int64)
	h.lastPickup = time.Now()
	h.lastCoin = time.Now()
	for id := range h.collecting {
		h.cancelCollect(id)
	}
}

func (h *ArenaHub) resetPlayersForRound(nowMS int64) {
	for _, c := range h.clients {
		c.mu.Lock()
		c.state.Score = 0
		c.state.Kills = 0
		c.state.Deaths = 0
		c.state.Ready = false
		c.state.Shield = 0
		c.state.ShieldT = 0
		c.state.StunUntil = 0
		c.state.LockedSpell = ""
		c.state.LockUntil = 0
		c.state.Buffs = nil
		c.derived = deriveStats(c.state.Talents)
		h.recomputePlayerDerivedStatsLocked(c, nowMS)
		c.state.HP = c.state.MaxHP
		c.state.Mana = c.state.MaxMana
		c.state.Alive = true
		c.state.RespawnT = 0
		c.state.InvulnT = nowMS + spawnInvulnMS
		c.mu.Unlock()
	}
	// spawn everyone spread out: place one at a time, each far from the rest
	placed := [][2]float64{}
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined {
			c.state.X, c.state.Z = pickSpawn(placed)
			placed = append(placed, [2]float64{c.state.X, c.state.Z})
		}
		c.mu.Unlock()
	}
}

// ------------------------------------------------------------ scoring

func (h *ArenaHub) computeLeader() {
	best := uint64(0)
	bestScore := 0
	tie := false
	for _, c := range h.clients {
		c.mu.Lock()
		s := c.state.Score
		joined := c.joined
		c.mu.Unlock()
		if !joined {
			continue
		}
		if s > bestScore {
			bestScore = s
			best = c.id
			tie = false
		} else if s == bestScore && s > 0 {
			tie = true
		}
	}
	if tie || bestScore <= 0 {
		best = 0
	}
	if best != h.match.LeaderID {
		h.match.LeaderID = best
		if best != 0 {
			h.broadcastJSON(sMsg{Type: "effect", Data: sEffect{Kind: "leader", Target: best}})
		}
	}
}

func (h *ArenaHub) standings() []standing {
	out := make([]standing, 0, len(h.clients))
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined {
			out = append(out, standing{
				ID: c.id, Name: c.state.Name, Model: c.state.Model,
				Score: c.state.Score, Kills: c.state.Kills, Deaths: c.state.Deaths,
				HODays: c.state.HODays, WeekScore: c.state.WeekScore,
			})
		}
		c.mu.Unlock()
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Score != out[j].Score {
			return out[i].Score > out[j].Score
		}
		if out[i].Kills != out[j].Kills {
			return out[i].Kills > out[j].Kills
		}
		if out[i].Deaths != out[j].Deaths {
			return out[i].Deaths < out[j].Deaths
		}
		return out[i].Name < out[j].Name
	})
	return out
}

// awardKill handles the kill broadcast for any death. Points are not handed
// out directly: they drop on the floor where the victim died and have to be
// picked up, so people fight over them.
func (h *ArenaHub) awardKill(killer, victim uint64, victimNPC bool, victimKind string, dropX, dropZ float64, nowMS int64) {
	playing := h.match.Phase == "playing"
	ev := sKill{Killer: killer, Victim: victim, VictimNPC: victimNPC, T: nowMS}

	if kc := h.clients[killer]; kc != nil {
		kc.mu.Lock()
		ev.KillerName = kc.state.Name
		kc.mu.Unlock()
	} else if n := h.npcs[killer]; n != nil {
		ev.KillerNPC = true
		ev.KillerName = n.state.Name
	}
	if victimNPC {
		if n := h.npcs[victim]; n != nil {
			ev.VictimName = n.state.Name
		}
	} else if vc := h.clients[victim]; vc != nil {
		vc.mu.Lock()
		ev.VictimName = vc.state.Name
		if playing {
			vc.state.Deaths++
			// dying costs a point (the coin that drops is extra, worth the kill)
			if vc.state.Score > 0 {
				vc.state.Score--
			}
		}
		vc.mu.Unlock()
	}

	points := 0
	if playing {
		if victimNPC {
			points = pointsKillNPC
			if victimKind == "reditel" {
				points = pointsKillBoss
				ev.Bonus = "boss"
			}
		} else {
			points = pointsKill
			if victim == h.match.LeaderID && victim != 0 {
				points = pointsKillLeader
				ev.Bonus = "leader"
			}
		}
	}
	if !victimNPC && !ev.KillerNPC && playing {
		if kc := h.clients[killer]; kc != nil {
			kc.mu.Lock()
			kc.state.Kills++
			kc.mu.Unlock()
		}
	}
	if points > 0 {
		h.spawnPointDrop(dropX, dropZ, points, nowMS)
	}
	ev.Points = points
	h.broadcastJSON(sMsg{Type: "kill", Data: ev})
}

// spawnPointDrop puts the points on the floor as a single coin worth the
// whole kill. Collecting it takes a couple of seconds of standing still.
func (h *ArenaHub) spawnPointDrop(x, z float64, points int, nowMS int64) {
	now := time.UnixMilli(nowMS)
	px := clamp(x, -mapHalfX+1, mapHalfX-1)
	pz := clamp(z, -mapHalfZ+1, mapHalfZ-1)
	if pointInObstacle(px, pz, 0.3) {
		// nudge out of furniture
		for _, d := range [][2]float64{{1, 0}, {-1, 0}, {0, 1}, {0, -1}, {1, 1}, {-1, -1}} {
			if !pointInObstacle(px+d[0]*1.2, pz+d[1]*1.2, 0.3) {
				px += d[0] * 1.2
				pz += d[1] * 1.2
				break
			}
		}
	}
	id := h.spawnPickup("point", px, pz, now, pointDropLifeMS)
	if p := h.pickups[id]; p != nil {
		p.Value = points
	}
}

// ------------------------------------------------------------ talents / ready

func (h *ArenaHub) applyTalent(ev talentEvent) {
	c, ok := h.clients[ev.player]
	if !ok {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.joined || c.state.TalentPts <= 0 {
		return
	}
	if !canTakeTalent(c.state.Talents, ev.id) {
		return
	}
	c.state.TalentPts--
	c.state.Talents = append(c.state.Talents, ev.id)
	oldMaxHP := c.state.MaxHP
	oldMaxMana := c.state.MaxMana
	c.derived = deriveStats(c.state.Talents)
	h.recomputePlayerDerivedStatsLocked(c, time.Now().UnixMilli())
	// growing the pool also fills the new part
	if c.state.MaxHP > oldMaxHP {
		c.state.HP += c.state.MaxHP - oldMaxHP
	}
	if c.state.MaxMana > oldMaxMana {
		c.state.Mana += c.state.MaxMana - oldMaxMana
	}
}

func (h *ArenaHub) applyReady(ev readyEvent) {
	c, ok := h.clients[ev.player]
	if !ok {
		return
	}
	c.mu.Lock()
	c.state.Ready = ev.ready
	c.mu.Unlock()
}
