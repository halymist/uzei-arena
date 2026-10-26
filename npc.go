package main

import (
	"math"
	"math/rand"
	"time"
)

// The office crew. They are PvE flavour with PvP roles:
//   Náměstek hunts the current leader ("Martin"), so everyone knows where he is.
//   Ředitel stays in his office and is worth bonus points when killed.
//   Sofie heals anyone standing next to her in the kitchen.
//   Čurda stuns and confiscates one of your spells for a while.
//   Pes bites whoever comes close.

var (
	namestekLines = []string{
		"Nevíte, kde je Martin?",
		"Pošlete za mnou Martina",
		"Hledám Martina",
		"Neviděl někdo Martina?",
		"Martin?",
		"Martineee?",
		"Byl tady Martin?",
		"Hledám kompetentní osobu",
	}
	namestekHuntLines = []string{
		"Martine! Tady jsi!",
		"Martine, na slovíčko!",
		"MARTINE!",
		"Martine, kam utíkáš?",
		"Martine, deleguju to na vás",
	}
	dogLines = []string{
		"Woof woof",
		"Grrr",
		"Haf haf",
		"Vrrr",
		"Au au",
	}
	sofieLines = []string{
		"Привет!",
		"Как дела?",
		"Спасибо!",
		"Давай, погнали!",
		"Ну ладно...",
		"Кофе?",
	}
	curdaLines = []string{
		"Zálohujete na one-drive?",
		"Win11 je nejlepší operační systém",
		"Já si to vyfotim",
		"Seberu vám počítač",
	}
	reditelLines = []string{
		"Kdo to tady střílí?!",
		"Máte to v Excelu?",
		"Porada. Hned.",
	}
)

const (
	npcNamestek = 1001
	npcReditel  = 1002
	npcPes      = 1003
	npcSofie    = 1004
	npcCurda    = 1005
)

func npcIsDamageable(kind string) bool {
	return kind == "pes" || kind == "reditel" || kind == "namestek" || kind == "curda"
}

func npcRadius(kind string) float64 {
	switch kind {
	case "reditel":
		return 1.05
	case "namestek", "curda":
		return 0.72
	}
	return 0.6
}

func npcMaxHP(kind string) int {
	switch kind {
	case "reditel":
		return reditelHP
	case "namestek":
		return namestekHP
	case "curda":
		return curdaHP
	case "pes":
		return dogHP
	}
	return 0
}

func (h *ArenaHub) initNPCs() {
	now := time.Now().UnixMilli()
	h.npcs = map[uint64]*npcRuntime{}
	h.npcs[npcNamestek] = &npcRuntime{
		state:        npcState{ID: npcNamestek, Kind: "namestek", Name: "Náměstek", X: -6, Z: 4, Scale: 1.0, HP: namestekHP, MaxHP: namestekHP, Alive: true},
		home:         wholeMap,
		nextDirMS:    now + 1200,
		nextSayMS:    now + 3000,
		nextChargeMS: now + 2500,
	}
	rx, rz := roomReditelna.shrink(2).center()
	h.npcs[npcReditel] = &npcRuntime{
		state:            npcState{ID: npcReditel, Kind: "reditel", Name: "Ředitel", X: rx, Z: rz + 2, Scale: 1.0, HP: reditelHP, MaxHP: reditelHP, Alive: true, Bounty: pointsKillBoss},
		home:             roomReditelna.shrink(1.6),
		homeOnly:         true,
		nextDirMS:        now + 900,
		nextSayMS:        now + 6000,
		nextBeamMS:       now + 7000,
		nextBarrageReady: now,
	}
	h.npcs[npcPes] = &npcRuntime{
		state:     npcState{ID: npcPes, Kind: "pes", Name: "Pes", X: 2, Z: 2, Scale: 1.0, HP: dogHP, MaxHP: dogHP, Alive: true},
		home:      wholeMap,
		nextDirMS: now + 1000,
		nextSayMS: now + 2600,
	}
	kx, kz := roomKuchynka.shrink(2).center()
	h.npcs[npcSofie] = &npcRuntime{
		state:     npcState{ID: npcSofie, Kind: "sofie", Name: "Sofie", X: kx, Z: kz + 1, Scale: 1.0, Alive: true},
		home:      roomKuchynka.shrink(1.6),
		homeOnly:  true,
		nextDirMS: now + 1500,
		healAcc:   map[uint64]float64{},
	}
	h.npcs[npcCurda] = &npcRuntime{
		state:       npcState{ID: npcCurda, Kind: "curda", Name: "Čurda", X: 16, Z: 3, Scale: 1.0, HP: curdaHP, MaxHP: curdaHP, Alive: true},
		home:        wholeMap,
		nextDirMS:   now + 1100,
		nextSayMS:   now + 2800,
		nextStunMS:  now + 2000,
		nextSalvaMS: now + 3000,
	}
}

func (h *ArenaHub) closestAlivePlayer(x, z, maxDist float64) (uint64, float64, float64, bool) {
	bestID := uint64(0)
	bestX, bestZ := 0.0, 0.0
	bestD2 := maxDist * maxDist
	for _, c := range h.clients {
		c.mu.Lock()
		alive := c.state.Alive && c.joined
		px, pz := c.state.X, c.state.Z
		c.mu.Unlock()
		if !alive {
			continue
		}
		dx := px - x
		dz := pz - z
		d2 := dx*dx + dz*dz
		if d2 < bestD2 {
			bestD2 = d2
			bestID = c.id
			bestX, bestZ = px, pz
		}
	}
	return bestID, bestX, bestZ, bestID != 0
}

func (h *ArenaHub) alivePlayerByID(id uint64) (float64, float64, bool) {
	tc, ok := h.clients[id]
	if !ok {
		return 0, 0, false
	}
	tc.mu.Lock()
	alive := tc.state.Alive && tc.joined
	x, z := tc.state.X, tc.state.Z
	tc.mu.Unlock()
	return x, z, alive
}

// npcSay is the single gate for NPC speech: never interrupt a line that is
// still on screen, and keep a minimum gap between lines so a character does
// not rattle off several things in a row.
func npcSay(n *npcRuntime, lines []string, nowMS int64, cdMS int64) {
	if n.state.Say != "" && nowMS < n.state.SayUntil {
		return
	}
	if nowMS < n.nextSayReadyMS {
		return
	}
	n.state.Say = pickDifferentLine(lines, n.state.Say)
	n.state.SayUntil = nowMS + npcSayMS
	if cdMS < npcSayInternalCDMS {
		cdMS = npcSayInternalCDMS
	}
	n.nextSayReadyMS = nowMS + cdMS
}

func npcOneShotSpeak(n *npcRuntime, lines []string, nowMS int64, chance float64) {
	if rand.Float64() < chance {
		npcSay(n, lines, nowMS, npcSayInternalCDMS)
	}
}

func pickDifferentLine(lines []string, last string) string {
	if len(lines) == 0 {
		return ""
	}
	if len(lines) == 1 {
		return lines[0]
	}
	idx := rand.Intn(len(lines))
	if lines[idx] != last {
		return lines[idx]
	}
	return lines[(idx+1)%len(lines)]
}

// npcOnDamaged: aggro reactions when a player hurts an NPC.
func (h *ArenaHub) npcOnDamaged(n *npcRuntime, shooter uint64, nowMS int64) {
	sc := h.clients[shooter]
	if sc == nil {
		return
	}
	sc.mu.Lock()
	alive := sc.state.Alive
	sc.mu.Unlock()
	if !alive {
		return
	}
	switch n.state.Kind {
	case "pes", "curda":
		if n.aggroID == 0 {
			n.aggroID = shooter
			n.forcedAggroMS = nowMS + npcForcedAggroMS
			n.nextDirMS = nowMS + 250
			if n.state.Kind == "pes" {
				npcOneShotSpeak(n, dogLines, nowMS, 0.45)
			} else {
				npcOneShotSpeak(n, curdaLines, nowMS, 0.45)
			}
		}
	case "namestek":
		if n.aggroID == 0 && h.match.LeaderID == 0 {
			n.aggroID = shooter
			n.forcedAggroMS = nowMS + npcForcedAggroMS
			n.nextDirMS = nowMS + 250
			npcOneShotSpeak(n, namestekLines, nowMS, 0.45)
		}
	case "reditel":
		n.aggroID = shooter
		n.forcedAggroMS = nowMS + npcForcedAggroMS
		npcSay(n, reditelLines, nowMS, 12000)
		if n.barrageShots == 0 && nowMS >= n.nextBarrageReady {
			n.barrageShots = 3
			n.barrageTarget = shooter
			n.nextBarrageMS = nowMS
			n.nextBarrageReady = nowMS + reditelBarrageCDMS
		}
	}
}

func (h *ArenaHub) npcDie(n *npcRuntime, nowMS int64) {
	n.state.Alive = false
	n.state.StunUntil = 0
	n.state.Say = ""
	n.state.SayUntil = 0
	n.hpAcc = 0
	n.stunUntilMS = 0
	n.forcedAggroMS = 0
	n.aggroID = 0
	n.barrageShots = 0
	n.barrageTarget = 0
	n.nextBarrageMS = 0
	n.salvaShots = 0
	n.nextSalvaShot = 0
	n.beamFireMS = 0
	n.chargeEndMS = 0
	respawn := int64(npcRespawnMS)
	if n.state.Kind == "reditel" {
		respawn = bossRespawnMS
	}
	n.state.RespawnT = nowMS + respawn

	now := time.Now()
	drop := func(kind string, spread float64) {
		ang := rand.Float64() * 2 * math.Pi
		rad := 0.5 + rand.Float64()*spread
		h.spawnPickup(kind, n.state.X+math.Sin(ang)*rad, n.state.Z+math.Cos(ang)*rad, now, pickupLifeMS)
	}
	switch n.state.Kind {
	case "reditel":
		drop("hp", 1.6)
	case "namestek", "curda":
		drop("hp", 1.2)
	}
}

func (h *ArenaHub) npcRespawn(n *npcRuntime, nowMS int64) {
	n.state.Alive = true
	n.state.RespawnT = 0
	n.state.X, n.state.Z = randomFreePos(n.home, 0.8)
	n.vx, n.vz = 0, 0
	n.nextDirMS = nowMS + 600
	n.nextSayMS = nowMS + 2400
	n.nextHitMS = 0
	n.stunUntilMS = 0
	n.state.StunUntil = 0
	n.forcedAggroMS = 0
	n.aggroID = 0
	n.hpAcc = 0
	n.state.HP = npcMaxHP(n.state.Kind)
	n.state.MaxHP = n.state.HP
	switch n.state.Kind {
	case "namestek":
		n.nextChargeMS = nowMS + 2200
		n.chargeEndMS = 0
		n.chargeHitDone = false
	case "reditel":
		n.nextBeamMS = nowMS + 7000
		n.beamFireMS = 0
		n.nextBarrageMS = nowMS
		n.nextBarrageReady = nowMS
	case "curda":
		n.nextStunMS = nowMS + 2000
		n.nextSalvaMS = nowMS + 3000
	}
}

func (h *ArenaHub) scheduleReditelBeam(n *npcRuntime, targetID uint64, nowMS int64) bool {
	tx, tz, ok := h.alivePlayerByID(targetID)
	if !ok {
		_, tx, tz, ok = h.closestAlivePlayer(n.state.X, n.state.Z, 22)
		if !ok {
			return false
		}
	}
	dx := tx - n.state.X
	dz := tz - n.state.Z
	d := math.Hypot(dx, dz)
	if d <= 0.001 {
		return false
	}
	n.state.Facing = math.Atan2(dx, dz)
	n.beamDX = dx / d
	n.beamDZ = dz / d
	n.beamFireMS = nowMS + reditelBeamWindupMS
	n.vx, n.vz = 0, 0
	h.broadcastJSON(sMsg{Type: "fire", Data: sFire{Owner: n.state.ID, OX: n.state.X + n.beamDX, OZ: n.state.Z + n.beamDZ, DX: n.beamDX, DZ: n.beamDZ, Kind: "reditel_beam_warn", T: nowMS}})
	return true
}

// wanderDir picks a random direction, biased back home when outside.
func (n *npcRuntime) wanderDir(speed float64, nowMS int64) {
	if n.homeOnly && !n.home.contains(n.state.X, n.state.Z) {
		cx, cz := n.home.center()
		dx := cx - n.state.X
		dz := cz - n.state.Z
		d := math.Hypot(dx, dz)
		if d > 0.001 {
			n.vx = dx / d * speed
			n.vz = dz / d * speed
		}
	} else {
		ang := rand.Float64() * math.Pi * 2
		n.vx = math.Sin(ang) * speed
		n.vz = math.Cos(ang) * speed
	}
	n.state.Facing = math.Atan2(n.vx, n.vz)
	n.nextDirMS = nowMS + 1400 + int64(rand.Intn(2600))
}

// acquireTarget keeps the current aggro while in range, else looks for the
// closest player within aggroRange.
func (h *ArenaHub) acquireTarget(n *npcRuntime, aggroRange, deaggroRange float64, nowMS int64) bool {
	if n.aggroID != 0 {
		tx, tz, alive := h.alivePlayerByID(n.aggroID)
		if alive {
			dx := tx - n.state.X
			dz := tz - n.state.Z
			if nowMS < n.forcedAggroMS || dx*dx+dz*dz <= deaggroRange*deaggroRange {
				return true
			}
		}
	}
	n.aggroID = 0
	id, _, _, ok := h.closestAlivePlayer(n.state.X, n.state.Z, aggroRange)
	if ok {
		n.aggroID = id
		return true
	}
	return false
}

func (h *ArenaHub) updateNPCs(now time.Time, dt float64) {
	nowMS := now.UnixMilli()
	playing := (h.match.Phase == "playing" || h.match.Phase == "warmup") && !passiveNPC

	for _, n := range h.npcs {
		if !n.state.Alive {
			if n.state.RespawnT > 0 && nowMS >= n.state.RespawnT {
				h.npcRespawn(n, nowMS)
			}
			continue
		}

		if nowMS < n.stunUntilMS {
			n.state.StunUntil = n.stunUntilMS
			n.vx, n.vz = 0, 0
			if n.state.SayUntil > 0 && nowMS >= n.state.SayUntil {
				n.state.Say = ""
				n.state.SayUntil = 0
			}
			continue
		}
		n.state.StunUntil = 0

		// passive regen for the tougher ones
		regen := 0.0
		switch n.state.Kind {
		case "namestek":
			regen = namestekRegenPS
		case "reditel":
			regen = reditelRegenPS
		case "curda":
			regen = curdaRegenPS
		}
		if regen > 0 && n.state.HP < n.state.MaxHP {
			n.hpAcc += regen * dt
			if n.hpAcc >= 1 {
				add := int(n.hpAcc)
				n.hpAcc -= float64(add)
				n.state.HP = minInt(n.state.MaxHP, n.state.HP+add)
			}
		}

		switch n.state.Kind {
		case "pes":
			h.updateDog(n, nowMS, playing)
		case "namestek":
			h.updateNamestek(n, nowMS, playing)
		case "reditel":
			h.updateReditel(n, nowMS, playing)
		case "sofie":
			h.updateSofie(n, nowMS, dt)
		case "curda":
			h.updateCurda(n, nowMS, playing)
		}

		// integrate
		nx := n.state.X + n.vx*dt
		nz := n.state.Z + n.vz*dt
		rad := 0.55
		if n.state.Kind == "reditel" {
			rad = 0.7
		}
		nx, nz = resolveObstacleMove(n.state.X, n.state.Z, nx, nz, rad)
		if nx == n.state.X && n.vx != 0 {
			n.vx = 0
			n.nextDirMS = 0
		}
		if nz == n.state.Z && n.vz != 0 {
			n.vz = 0
			n.nextDirMS = 0
		}
		n.state.X = nx
		n.state.Z = nz
		lim := wholeMap
		if n.homeOnly {
			lim = n.home
		}
		if n.state.X < lim.minX || n.state.X > lim.maxX {
			n.vx = -n.vx
			n.state.X = clamp(n.state.X, lim.minX, lim.maxX)
		}
		if n.state.Z < lim.minZ || n.state.Z > lim.maxZ {
			n.vz = -n.vz
			n.state.Z = clamp(n.state.Z, lim.minZ, lim.maxZ)
		}
		if n.vx != 0 || n.vz != 0 {
			n.state.Facing = math.Atan2(n.vx, n.vz)
		}

		if n.state.SayUntil > 0 && nowMS >= n.state.SayUntil {
			n.state.Say = ""
			n.state.SayUntil = 0
		}
	}
}

func (h *ArenaHub) updateDog(n *npcRuntime, nowMS int64, playing bool) {
	had := n.aggroID != 0
	if playing && h.acquireTarget(n, dogAggroRange, dogDeaggroRng, nowMS) {
		if !had {
			npcOneShotSpeak(n, dogLines, nowMS, 1.0)
		}
		tx, tz, _ := h.alivePlayerByID(n.aggroID)
		d := math.Hypot(tx-n.state.X, tz-n.state.Z)
		h.chaseMove(n, tx, tz, dogChaseSpeed, nowMS)
		if d <= dogTouchRange && nowMS >= n.nextHitMS {
			n.nextHitMS = nowMS + dogHitCDMS
			h.applyHit(hitEvent{shooter: n.state.ID, target: n.aggroID, dmg: dogTouchDmg})
		}
		return
	}
	if nowMS >= n.nextDirMS {
		n.wanderDir(dogWanderSpeed, nowMS)
	}
}

func (h *ArenaHub) updateNamestek(n *npcRuntime, nowMS int64, playing bool) {
	// The leader is "Martin". Náměstek drops everything to find him.
	hunting := false
	if playing && h.match.LeaderID != 0 {
		if _, _, alive := h.alivePlayerByID(h.match.LeaderID); alive {
			if n.aggroID != h.match.LeaderID {
				n.aggroID = h.match.LeaderID
			}
			hunting = true
			npcSay(n, namestekHuntLines, nowMS, 16000)
		}
	}
	had := n.aggroID != 0
	if hunting || (playing && h.acquireTarget(n, namestekAggroRng, namestekDeaggroRng, nowMS)) {
		if !had && !hunting {
			npcOneShotSpeak(n, namestekLines, nowMS, 1.0)
		}
		tx, tz, _ := h.alivePlayerByID(n.aggroID)
		dx := tx - n.state.X
		dz := tz - n.state.Z
		d := math.Hypot(dx, dz)
		if d > 0.001 {
			n.state.Facing = math.Atan2(dx, dz)
		}
		if n.chargeEndMS > nowMS {
			if !n.chargeHitDone && d <= namestekChargeHitR {
				n.chargeHitDone = true
				n.nextHitMS = nowMS + namestekHitCDMS
				h.applyHit(hitEvent{shooter: n.state.ID, target: n.aggroID, dmg: namestekChargeDmg})
				h.applyStunPlayer(n.aggroID, namestekChargeStunMS)
			}
			return
		}
		n.chargeHitDone = false
		if d <= namestekTouchRange && nowMS >= n.nextHitMS {
			n.nextHitMS = nowMS + namestekHitCDMS
			h.applyHit(hitEvent{shooter: n.state.ID, target: n.aggroID, dmg: namestekTouchDmg})
		} else if nowMS >= n.nextChargeMS && d >= namestekChargeMinRange && d <= namestekChargeRange && lineFree(n.state.X, n.state.Z, tx, tz, 0.5) {
			n.vx = dx / d * namestekChargeSpeed
			n.vz = dz / d * namestekChargeSpeed
			n.chargeEndMS = nowMS + namestekChargeMS
			n.nextChargeMS = nowMS + namestekChargeCDMS + int64(rand.Intn(1200))
		} else if d > 0.001 {
			speed := namestekChaseSpeed
			if hunting && d > 12 {
				speed = namestekHuntSpeed
			}
			h.chaseMove(n, tx, tz, speed, nowMS)
		}
		return
	}
	if nowMS >= n.nextDirMS {
		n.wanderDir(namestekWanderSpeed, nowMS)
	}
}

func (h *ArenaHub) updateReditel(n *npcRuntime, nowMS int64, playing bool) {
	if n.beamFireMS > 0 {
		n.vx, n.vz = 0, 0
		if nowMS >= n.beamFireMS {
			h.spawnNPCProjectile(n.state.ID, n.state.X+n.beamDX, n.state.Z+n.beamDZ, n.beamDX, n.beamDZ, reditelBeamSpeed, reditelBeamRange, reditelBeamRad, reditelBeamDmg, "reditel_beam")
			n.beamFireMS = 0
		}
		return
	}
	if !playing {
		if nowMS >= n.nextDirMS {
			n.wanderDir(0.9, nowMS)
		}
		return
	}
	if n.barrageShots > 0 && nowMS >= n.nextBarrageMS {
		if h.scheduleReditelBeam(n, n.barrageTarget, nowMS) {
			n.barrageShots--
			n.nextBarrageMS = nowMS + reditelBeamWindupMS + reditelBarrageGapMS
		} else {
			n.barrageShots = 0
		}
		return
	}
	if n.barrageShots == 0 && nowMS >= n.nextBeamMS {
		if h.scheduleReditelBeam(n, 0, nowMS) {
			n.nextBeamMS = nowMS + reditelBeamCDMS + int64(rand.Intn(2500))
			return
		}
		n.nextBeamMS = nowMS + 1500
	}
	if nowMS >= n.pauseToMS && n.burstEndMS == 0 {
		n.burstEndMS = nowMS + reditelBurstMS
		n.nextHitMS = nowMS
	}
	if n.burstEndMS > 0 && nowMS >= n.burstEndMS {
		n.burstEndMS = 0
		n.pauseToMS = nowMS + reditelPauseMS
		n.nextHitMS = n.pauseToMS
	}
	if n.burstEndMS > 0 && nowMS >= n.nextHitMS {
		if _, tx, tz, ok := h.closestAlivePlayer(n.state.X, n.state.Z, reditelMissileRange); ok {
			dx := tx - n.state.X
			dz := tz - n.state.Z
			d := math.Hypot(dx, dz)
			if d > 0.001 {
				n.state.Facing = math.Atan2(dx, dz)
				h.spawnNPCProjectile(n.state.ID, n.state.X+dx/d*0.9, n.state.Z+dz/d*0.9, dx/d, dz/d, reditelMissileSpeed, reditelMissileRange, reditelMissileRad, reditelMissileDmg, "reditel")
			}
		}
		n.nextHitMS = nowMS + reditelShotCDMS
	}
	if nowMS >= n.nextDirMS {
		n.wanderDir(0.9, nowMS)
	}
}

func (h *ArenaHub) updateSofie(n *npcRuntime, nowMS int64, dt float64) {
	anyNear := false
	for _, c := range h.clients {
		c.mu.Lock()
		if c.joined && c.state.Alive {
			dx := c.state.X - n.state.X
			dz := c.state.Z - n.state.Z
			if dx*dx+dz*dz <= sofieHealRange*sofieHealRange {
				anyNear = true
				acc := n.healAcc[c.id] + float64(c.state.MaxHP)*sofieHealPctPS*dt
				if acc >= 1 {
					add := int(acc)
					acc -= float64(add)
					if c.state.HP < c.state.MaxHP {
						c.state.HP = minInt(c.state.MaxHP, c.state.HP+add)
					}
					manaAdd := int(math.Round(float64(c.state.MaxMana) * sofieHealPctPS * dt * float64(add) / math.Max(1, float64(c.state.MaxHP)*sofieHealPctPS*dt)))
					if c.state.Mana < c.state.MaxMana {
						c.state.Mana = minInt(c.state.MaxMana, c.state.Mana+maxInt(0, manaAdd))
					}
				}
				n.healAcc[c.id] = acc
			} else {
				delete(n.healAcc, c.id)
			}
		}
		c.mu.Unlock()
	}
	if anyNear {
		n.vx, n.vz = 0, 0
		npcSay(n, sofieLines, nowMS, sofieTalkCDMS)
		return
	}
	if nowMS >= n.nextDirMS {
		n.wanderDir(sofieWanderSpeed, nowMS)
	}
}

func (h *ArenaHub) updateCurda(n *npcRuntime, nowMS int64, playing bool) {
	had := n.aggroID != 0
	if playing && h.acquireTarget(n, curdaAggroRng, curdaDeaggroRng, nowMS) {
		if !had {
			npcOneShotSpeak(n, curdaLines, nowMS, 1.0)
		}
		tx, tz, _ := h.alivePlayerByID(n.aggroID)
		dx := tx - n.state.X
		dz := tz - n.state.Z
		d := math.Hypot(dx, dz)
		if d <= 0.001 {
			return
		}
		n.state.Facing = math.Atan2(dx, dz)

		if n.salvaShots > 0 && nowMS >= n.nextSalvaShot {
			h.spawnNPCProjectile(n.state.ID, n.state.X+dx/d*0.9, n.state.Z+dz/d*0.9, dx/d, dz/d, curdaSalvaSpeed, curdaSalvaRange, curdaSalvaRad, curdaSalvaDmg, "curda_salva")
			n.salvaShots--
			n.nextSalvaShot = nowMS + curdaSalvaIntervalMS
		}
		if nowMS >= n.nextStunMS && d <= curdaAggroRng {
			h.spawnNPCProjectile(n.state.ID, n.state.X+dx/d*0.9, n.state.Z+dz/d*0.9, dx/d, dz/d, curdaStunSpeed, curdaStunRange, curdaStunRad, curdaStunDmg, "curda_stun")
			n.nextStunMS = nowMS + curdaStunCDMS
			npcSay(n, []string{"Seberu vám počítač!", "Já si to vyfotim"}, nowMS, npcSayInternalCDMS)
		}
		if nowMS >= n.nextSalvaMS && n.salvaShots == 0 {
			n.salvaShots = curdaSalvaShots
			n.nextSalvaShot = nowMS
			n.nextSalvaMS = nowMS + curdaSalvaCDMS
		}
		if d < curdaPreferredDist {
			n.vx = -dx / d * curdaKiteSpeed
			n.vz = -dz / d * curdaKiteSpeed
		} else {
			side := 1.0
			if n.state.ID%2 == 0 {
				side = -1.0
			}
			n.vx = (dz / d) * curdaWanderSpeed * side
			n.vz = (-dx / d) * curdaWanderSpeed * side
		}
		return
	}
	if nowMS >= n.nextDirMS {
		n.wanderDir(curdaWanderSpeed, nowMS)
	}
}
