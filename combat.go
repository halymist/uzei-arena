package main

import (
	"math"
	"math/rand"
	"time"
)

func manaCost(kind string) int {
	switch kind {
	case "q":
		return qCost
	case "w":
		return wCost
	case "r":
		return rCost
	case "e":
		return eCost
	case "c":
		return chargeCost
	case "v":
		return vCost
	case "x":
		return xCost
	case "z":
		return zCost
	case "s":
		return sCost
	case "f":
		return fCost
	case "g":
		return gCost
	}
	return 0
}

// spellAllowedLocked: the player owns the spell and Čurda has not taken it.
func spellAllowedLocked(c *client, kind string, nowMS int64) bool {
	if kind == "" {
		return false
	}
	if !c.derived.Spells[kind] {
		return false
	}
	if c.state.LockedSpell == kind && c.state.LockUntil > nowMS {
		return false
	}
	return true
}

func scaledOutgoingDamage(base int, dmgMult float64, hasDmgBuff bool) int {
	if base <= 0 {
		return 0
	}
	m := dmgMult
	if hasDmgBuff {
		m *= 1.0 + buffDmgPct
	}
	out := int(math.Round(float64(base) * m))
	if out < 1 {
		return 1
	}
	return out
}

func hasActiveBuff(buffs []playerBuffState, kind string, nowMS int64) bool {
	for _, b := range buffs {
		if b.Kind == kind && b.Until > nowMS {
			return true
		}
	}
	return false
}

func (h *ArenaHub) recomputePlayerDerivedStatsLocked(c *client, nowMS int64) {
	active := c.state.Buffs[:0]
	for _, b := range c.state.Buffs {
		if b.Until > nowMS {
			active = append(active, b)
		}
	}
	c.state.Buffs = active
	if c.state.LockUntil > 0 && nowMS >= c.state.LockUntil {
		c.state.LockedSpell = ""
		c.state.LockUntil = 0
	}

	maxHP := int(math.Round(float64(startHP) * c.derived.HPMult))
	maxMana := int(math.Round(float64(startMana) * c.derived.ManaMult))
	if hasActiveBuff(c.state.Buffs, "hp", nowMS) {
		maxHP = int(math.Round(float64(maxHP) * (1.0 + buffStatPct)))
	}
	if hasActiveBuff(c.state.Buffs, "mana", nowMS) {
		maxMana = int(math.Round(float64(maxMana) * (1.0 + buffStatPct)))
	}
	if maxHP < 1 {
		maxHP = 1
	}
	c.state.MaxHP = maxHP
	c.state.MaxMana = maxMana
	if c.state.HP > maxHP {
		c.state.HP = maxHP
	}
	if c.state.Mana > maxMana {
		c.state.Mana = maxMana
	}
}

func (h *ArenaHub) applyBuffPickupLocked(c *client, pickupKind string, nowMS int64) {
	kind := ""
	switch pickupKind {
	case "buff_speed":
		kind = "speed"
	case "buff_hp":
		kind = "hp"
	case "buff_mana":
		kind = "mana"
	case "buff_dmg":
		kind = "dmg"
	default:
		return
	}
	oldMaxHP := c.state.MaxHP
	oldMaxMana := c.state.MaxMana
	until := nowMS + buffDurationMS
	updated := false
	for i := range c.state.Buffs {
		if c.state.Buffs[i].Kind == kind {
			c.state.Buffs[i].Until = until
			updated = true
			break
		}
	}
	if !updated {
		c.state.Buffs = append(c.state.Buffs, playerBuffState{Kind: kind, Until: until})
	}
	h.recomputePlayerDerivedStatsLocked(c, nowMS)
	if kind == "hp" && c.state.HP == oldMaxHP {
		c.state.HP = c.state.MaxHP
	}
	if kind == "mana" && c.state.Mana == oldMaxMana {
		c.state.Mana = c.state.MaxMana
	}
}

// ------------------------------------------------------------ regen / respawn

func (h *ArenaHub) regen(dt float64) {
	nowMS := time.Now().UnixMilli()
	for _, c := range h.clients {
		c.mu.Lock()
		if c.state.Alive {
			h.recomputePlayerDerivedStatsLocked(c, nowMS)
			maxHP := c.state.MaxHP
			maxMana := c.state.MaxMana
			if c.state.ShieldT > 0 && nowMS >= c.state.ShieldT {
				c.state.Shield = 0
				c.state.ShieldT = 0
			}
			if c.state.HP < maxHP {
				c.hpAcc += float64(maxHP) * hpRegenPctPerSec * c.derived.RegenMult * dt
				if c.hpAcc >= 1 {
					add := int(c.hpAcc)
					c.hpAcc -= float64(add)
					c.state.HP += add
					if c.state.HP > maxHP {
						c.state.HP = maxHP
					}
				}
			} else {
				c.hpAcc = 0
			}
			if c.state.Mana < maxMana {
				c.manaAcc += float64(maxMana) * manaRegenPctPerSec * dt
				if c.manaAcc >= 1 {
					add := int(c.manaAcc)
					c.manaAcc -= float64(add)
					c.state.Mana += add
					if c.state.Mana > maxMana {
						c.state.Mana = maxMana
					}
				}
			} else {
				c.manaAcc = 0
			}
		}
		c.mu.Unlock()
	}
}

func (h *ArenaHub) processRespawns(nowMS int64) {
	for id, atMS := range h.respawnAt {
		if nowMS < atMS {
			continue
		}
		h.respawnPlayer(id)
		delete(h.respawnAt, id)
	}
}

func (h *ArenaHub) respawnPlayer(id uint64) {
	c, ok := h.clients[id]
	if !ok {
		return
	}
	x, z := pickSpawn(h.enemyPositions(id))
	c.mu.Lock()
	defer c.mu.Unlock()
	c.state.HP = c.state.MaxHP
	c.state.Mana = c.state.MaxMana
	c.state.Shield = 0
	c.state.ShieldT = 0
	c.state.InvulnT = time.Now().UnixMilli() + spawnInvulnMS
	c.state.Alive = true
	c.state.StunUntil = 0
	c.state.RespawnT = 0
	c.state.X, c.state.Z = x, z
	c.hpAcc = 0
	c.manaAcc = 0
}

// ------------------------------------------------------------ pickups

func (h *ArenaHub) expirePickups(now time.Time) {
	nowMS := now.UnixMilli()
	for id, p := range h.pickups {
		if p.ExpireMS > 0 && nowMS >= p.ExpireMS {
			delete(h.pickups, id)
		}
	}
}

func (h *ArenaHub) maybeSpawnPickup(now time.Time) {
	healing := 0
	for _, p := range h.pickups {
		if p.Kind == "hp" || p.Kind == "mana" {
			healing++
		}
	}
	if healing >= maxPickups {
		return
	}
	if now.Sub(h.lastPickup) < pickupSpawnMS*time.Millisecond {
		return
	}
	h.lastPickup = now
	kind := "hp"
	if rand.Intn(4) == 0 {
		kind = "mana"
	}
	x, z := h.randomPickupPos()
	h.spawnPickup(kind, x, z, now, pickupLifeMS)
}

// maybeSpawnCoin drops a neutral 1-point coin now and then so there is
// always something on the floor worth a fight.
func (h *ArenaHub) maybeSpawnCoin(now time.Time) {
	coins := 0
	for _, p := range h.pickups {
		if p.Kind == "point" {
			coins++
		}
	}
	if coins >= maxFloorCoins || now.Sub(h.lastCoin) < coinSpawnMS*time.Millisecond {
		return
	}
	h.lastCoin = now
	x, z := h.randomPickupPos()
	h.spawnPickup("point", x, z, now, pointDropLifeMS)
}

func (h *ArenaHub) maybeSpawnBuffPickup(now time.Time) {
	if now.Sub(h.lastBuff) < buffSpawnMS*time.Millisecond {
		return
	}
	buffOnGround := 0
	for _, p := range h.pickups {
		if len(p.Kind) > 5 && p.Kind[:5] == "buff_" {
			buffOnGround++
		}
	}
	if buffOnGround >= maxBuffPickups {
		return
	}
	h.lastBuff = now
	buffKinds := []string{"buff_speed", "buff_hp", "buff_mana", "buff_dmg"}
	kind := buffKinds[rand.Intn(len(buffKinds))]
	x, z := h.randomPickupPos()
	h.spawnPickup(kind, x, z, now, buffPickupLifeMS)
}

func (h *ArenaHub) randomPickupPos() (float64, float64) {
	for i := 0; i < 80; i++ {
		x, z := wholeMap.randomPoint()
		if pointInObstacle(x, z, 0.8) {
			continue
		}
		blocked := false
		for _, n := range h.npcs {
			if n.state.Alive && math.Hypot(n.state.X-x, n.state.Z-z) < 2.0 {
				blocked = true
				break
			}
		}
		if !blocked {
			return x, z
		}
	}
	return 0, 0
}

func (h *ArenaHub) spawnPickup(kind string, x, z float64, now time.Time, lifeMS int64) uint64 {
	id := h.nextPickID.Add(1)
	nowMS := now.UnixMilli()
	expire := int64(0)
	if lifeMS > 0 {
		expire = nowMS + lifeMS
	}
	h.pickups[id] = &pickup{
		ID: id, Kind: kind, Value: 1,
		X: clamp(x, -mapHalfX+1, mapHalfX-1), Z: clamp(z, -mapHalfZ+1, mapHalfZ-1),
		SpawnAtMS: nowMS, ExpireMS: expire,
	}
	return id
}

func (h *ArenaHub) applyPickup(ev pickEvent) {
	p, ok := h.pickups[ev.pickup]
	if !ok {
		return
	}
	c, ok := h.clients[ev.player]
	if !ok {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.state.Alive {
		return
	}
	dx := c.state.X - p.X
	dz := c.state.Z - p.Z
	if dx*dx+dz*dz > pickupRadius*pickupRadius*4 {
		return
	}
	delete(h.pickups, p.ID)
	nowMS := time.Now().UnixMilli()
	switch p.Kind {
	case "hp":
		restore := int(math.Round(float64(c.state.MaxHP) * 0.30))
		c.state.HP = minInt(c.state.MaxHP, c.state.HP+maxInt(1, restore))
		h.broadcastJSON(sMsg{Type: "effect", Data: sEffect{Kind: "heal", Target: c.id, Amount: restore}})
	case "mana":
		restore := int(math.Round(float64(c.state.MaxMana) * 0.30))
		c.state.Mana = minInt(c.state.MaxMana, c.state.Mana+maxInt(1, restore))
	case "point":
		// points are collected by channeling, see applyCollect
		h.pickups[p.ID] = p
		return
	default:
		h.applyBuffPickupLocked(c, p.Kind, nowMS)
	}
}

// ------------------------------------------------------------ point collection

// Points lie on the floor as coins. Picking one up means standing on it for
// pointCollectMS; moving, a stun or death interrupts it, and anyone else can
// start their own attempt on the same coin.

func (h *ArenaHub) cancelCollect(playerID uint64) {
	if _, ok := h.collecting[playerID]; !ok {
		return
	}
	delete(h.collecting, playerID)
	if c, ok := h.clients[playerID]; ok {
		c.mu.Lock()
		c.state.CollectPickup = 0
		c.state.CollectUntil = 0
		c.mu.Unlock()
	}
}

func (h *ArenaHub) applyCollect(ev collectEvent) {
	c, ok := h.clients[ev.player]
	if !ok {
		return
	}
	if !ev.start {
		h.cancelCollect(ev.player)
		return
	}
	if h.match.Phase != "playing" {
		return
	}
	p, ok := h.pickups[ev.pickup]
	if !ok || p.Kind != "point" {
		return
	}
	nowMS := time.Now().UnixMilli()
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.state.Alive || c.state.StunUntil > nowMS {
		return
	}
	dx := c.state.X - p.X
	dz := c.state.Z - p.Z
	if dx*dx+dz*dz > pointCollectRange*pointCollectRange {
		return
	}
	if cur, ok := h.collecting[ev.player]; ok && cur.pickupID == ev.pickup {
		return // already on it
	}
	h.collecting[ev.player] = &collectState{pickupID: ev.pickup, startMS: nowMS, baseX: c.state.X, baseZ: c.state.Z}
	c.state.CollectPickup = ev.pickup
	c.state.CollectUntil = nowMS + pointCollectMS
}

func (h *ArenaHub) updateCollects(nowMS int64) {
	for playerID, cs := range h.collecting {
		c, ok := h.clients[playerID]
		if !ok || h.match.Phase != "playing" {
			h.cancelCollect(playerID)
			continue
		}
		p, ok := h.pickups[cs.pickupID]
		if !ok || p.Kind != "point" {
			h.cancelCollect(playerID)
			continue
		}
		c.mu.Lock()
		alive := c.state.Alive
		stunned := c.state.StunUntil > nowMS
		x, z := c.state.X, c.state.Z
		c.mu.Unlock()
		if !alive || stunned {
			h.cancelCollect(playerID)
			continue
		}
		mx := x - cs.baseX
		mz := z - cs.baseZ
		if mx*mx+mz*mz > pointCollectMoveBreak*pointCollectMoveBreak {
			h.cancelCollect(playerID)
			continue
		}
		if nowMS-cs.startMS < pointCollectMS {
			continue
		}
		// done: the coin is gone for everyone, the collector scores
		delete(h.pickups, cs.pickupID)
		v := maxInt(1, p.Value)
		c.mu.Lock()
		c.state.Score += v
		c.mu.Unlock()
		h.cancelCollect(playerID)
		for other, ocs := range h.collecting {
			if ocs.pickupID == cs.pickupID {
				h.cancelCollect(other)
			}
		}
		h.broadcastJSON(sMsg{Type: "effect", Data: sEffect{Kind: "score", Target: playerID, Amount: v, X: p.X, Z: p.Z}})
	}
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// ------------------------------------------------------------ casting

func (h *ArenaHub) applyCast(ev castEvent) {
	c, ok := h.clients[ev.id]
	if !ok {
		return
	}
	nowMS := time.Now().UnixMilli()
	cost := manaCost(ev.kind)
	c.mu.Lock()
	if !c.state.Alive || !spellAllowedLocked(c, ev.kind, nowMS) || c.state.Mana < cost {
		c.mu.Unlock()
		return
	}
	h.recomputePlayerDerivedStatsLocked(c, nowMS)
	c.state.Mana -= cost
	// purely cosmetic: lets other clients play the cast animation
	h.broadcastJSON(sMsg{Type: "effect", Data: sEffect{Kind: "cast", Target: c.id, Spell: ev.kind}})

	if ev.kind == "e" && ev.hasPos {
		c.state.X = clamp(ev.x, -mapHalfX, mapHalfX)
		c.state.Z = clamp(ev.z, -mapHalfZ, mapHalfZ)
	}

	if ev.kind == "s" {
		shield := int(math.Round(float64(c.state.MaxHP) * c.derived.ShieldPct))
		if shield < 1 {
			shield = 1
		}
		c.state.Shield = shield
		c.state.ShieldT = nowMS + shieldDurationMS
		c.mu.Unlock()
		return
	}

	dmgMult := c.derived.DmgMult
	hasDmgBuff := hasActiveBuff(c.state.Buffs, "dmg", nowMS)
	facing := c.state.Facing
	sx := c.state.X
	sz := c.state.Z
	owner := c.id
	c.mu.Unlock()

	switch ev.kind {
	case "f":
		h.orbitals[owner] = &playerOrbit{owner: owner, endMS: nowMS + fOrbitDurationMS, nextMS: nowMS}
		h.broadcastJSON(sMsg{Type: "fire", Data: sFire{Owner: owner, OX: sx, OZ: sz, DX: fOrbitRadius, DZ: float64(fOrbitDurationMS) / 1000.0, Kind: "f_orbit", T: nowMS}})
	case "v":
		h.auras[owner] = &playerAura{Owner: owner, EndMS: nowMS + vDurationMS, NextTick: nowMS, Radius: vBaseRadius, Damage: scaledOutgoingDamage(vBaseDamage, dmgMult, hasDmgBuff)}
		h.broadcastJSON(sMsg{Type: "fire", Data: sFire{Owner: owner, OX: sx, OZ: sz, DX: vBaseRadius, DZ: float64(vDurationMS) / 1000.0, Kind: "pool_cast", T: nowMS}})
	case "c":
		h.applyCharge(owner, sx, sz, facing, scaledOutgoingDamage(chargeDamageBase, dmgMult, hasDmgBuff))
	}
}

func (h *ArenaHub) applyCharge(owner uint64, sx, sz, facing float64, dmg int) {
	dx := math.Sin(facing)
	dz := math.Cos(facing)
	ex := clamp(sx+dx*chargeDashDist, -mapHalfX, mapHalfX)
	ez := clamp(sz+dz*chargeDashDist, -mapHalfZ, mapHalfZ)
	hitR := chargeHitRadius

	for id, t := range h.clients {
		if id == owner {
			continue
		}
		t.mu.Lock()
		tAlive := t.state.Alive
		tx := t.state.X
		tz := t.state.Z
		t.mu.Unlock()
		if !tAlive {
			continue
		}
		if pointSegmentDist2(tx, tz, sx, sz, ex, ez) <= hitR*hitR {
			h.applyHit(hitEvent{shooter: owner, target: id, pid: 0, dmg: dmg})
			h.applyStunPlayer(id, chargeStunMS)
		}
	}
	for id, n := range h.npcs {
		if !n.state.Alive || !npcIsDamageable(n.state.Kind) {
			continue
		}
		r := chargeHitRadius + npcRadius(n.state.Kind)
		if pointSegmentDist2(n.state.X, n.state.Z, sx, sz, ex, ez) <= r*r {
			h.applyHit(hitEvent{shooter: owner, target: id, pid: 0, dmg: dmg})
			h.applyStunNPC(id, chargeStunMS)
		}
	}
}

func (h *ArenaHub) applyFire(ev fireEvent) {
	c, ok := h.clients[ev.shooter]
	if !ok {
		return
	}
	nowMS := time.Now().UnixMilli()
	cost := manaCost(ev.kind)
	if ev.kind == "q" {
		cost = 0 // the burst was paid by the "cast" message
	}
	c.mu.Lock()
	if !c.state.Alive || !spellAllowedLocked(c, ev.kind, nowMS) || c.state.Mana < cost {
		c.mu.Unlock()
		return
	}
	c.state.Mana -= cost
	if ev.kind != "q" && ev.kind != "aa" {
		h.registerProjectileKind(ev.shooter, ev.pid, ev.kind)
	}
	c.mu.Unlock()

	h.broadcastJSON(sMsg{Type: "fire", Data: sFire{
		Owner: ev.shooter, PID: ev.pid,
		OX: ev.ox, OZ: ev.oz, DX: ev.dx, DZ: ev.dz,
		Kind: ev.kind, T: nowMS,
	}})
}

func (h *ArenaHub) registerProjectileKind(shooter, pid uint64, kind string) {
	if pid == 0 {
		return
	}
	m, ok := h.projKinds[shooter]
	if !ok {
		m = make(map[uint64]string)
		h.projKinds[shooter] = m
	}
	m[pid] = kind
	// keep the map bounded
	if len(m) > 512 {
		for k := range m {
			if k < pid-256 {
				delete(m, k)
			}
		}
	}
}

func (h *ArenaHub) projectileKind(shooter, pid uint64) string {
	if pid == 0 {
		return ""
	}
	m := h.projKinds[shooter]
	if m == nil {
		return ""
	}
	return m[pid]
}

// ------------------------------------------------------------ stuns / locks

func (h *ArenaHub) applyStunPlayer(id uint64, durMS int64) {
	c, ok := h.clients[id]
	if !ok {
		return
	}
	nowMS := time.Now().UnixMilli()
	c.mu.Lock()
	if c.state.Alive {
		if c.state.ShieldT > 0 && nowMS >= c.state.ShieldT {
			c.state.Shield = 0
			c.state.ShieldT = 0
		}
		if !(c.state.Shield > 0 && c.state.ShieldT > nowMS) {
			until := nowMS + durMS
			if until > c.state.StunUntil {
				c.state.StunUntil = until
			}
		}
	}
	c.mu.Unlock()
}

func (h *ArenaHub) applyStunNPC(id uint64, durMS int64) {
	n, ok := h.npcs[id]
	if !ok || !n.state.Alive {
		return
	}
	nowMS := time.Now().UnixMilli()
	until := nowMS + durMS
	if until > n.stunUntilMS {
		n.stunUntilMS = until
		n.state.StunUntil = until
	}
}

// lockRandomSpellLocked is Čurda confiscating a computer: one owned spell is
// unusable for a while.
func (h *ArenaHub) lockRandomSpellLocked(c *client, nowMS int64) (string, int64) {
	candidates := make([]string, 0, 8)
	for k := range c.derived.Spells {
		if k != "aa" {
			candidates = append(candidates, k)
		}
	}
	if len(candidates) == 0 {
		return "", 0
	}
	kind := candidates[rand.Intn(len(candidates))]
	c.state.LockedSpell = kind
	c.state.LockUntil = nowMS + curdaLockMS
	return kind, c.state.LockUntil
}

// ------------------------------------------------------------ hits

func (h *ArenaHub) applyHit(ev hitEvent) {
	nowMS := time.Now().UnixMilli()
	dmgMult := 1.0
	rDmgMult := 1.0
	lifesteal := 0.0
	hasDmgBuff := false
	shooter := h.clients[ev.shooter]
	if shooter != nil {
		shooter.mu.Lock()
		h.recomputePlayerDerivedStatsLocked(shooter, nowMS)
		dmgMult = shooter.derived.DmgMult
		rDmgMult = shooter.derived.RDmgMult
		lifesteal = shooter.derived.Lifesteal
		hasDmgBuff = hasActiveBuff(shooter.state.Buffs, "dmg", nowMS)
		shooter.mu.Unlock()
	}
	kind := h.projectileKind(ev.shooter, ev.pid)
	if kind == "" && ev.pid != 0 {
		if pr, ok := h.npcProjs[ev.pid]; ok {
			kind = pr.Kind
		}
	}

	dmg := ev.dmg
	if dmg <= 0 {
		dmg = hitDamage
	}
	if shooter != nil {
		if kind == "r" {
			dmgMult *= rDmgMult
		}
		dmg = scaledOutgoingDamage(dmg, dmgMult, hasDmgBuff)
	}
	// Upír: part of the damage comes back as life
	drain := func(dealt int) {
		if shooter == nil || lifesteal <= 0 || dealt <= 0 {
			return
		}
		heal := int(math.Round(float64(dealt) * lifesteal))
		if heal <= 0 {
			return
		}
		shooter.mu.Lock()
		if shooter.state.Alive {
			shooter.state.HP = minInt(shooter.state.MaxHP, shooter.state.HP+heal)
		}
		shooter.mu.Unlock()
	}

	// ---- NPC target
	if target, ok := h.clients[ev.target]; !ok {
		n, isNPC := h.npcs[ev.target]
		if !isNPC || !n.state.Alive || !npcIsDamageable(n.state.Kind) {
			return
		}
		if dmg > n.state.MaxHP {
			dmg = n.state.MaxHP
		}
		n.state.HP -= dmg
		drain(dmg)
		h.npcOnDamaged(n, ev.shooter, nowMS)
		killed := n.state.HP <= 0
		if killed {
			n.state.HP = 0
			h.npcDie(n, nowMS)
		} else if kind == "x" {
			h.applyStunNPC(ev.target, xStunBaseMS)
		}
		h.broadcastJSON(sMsg{Type: "hit", Data: sHit{Shooter: ev.shooter, Target: ev.target, PID: ev.pid, HP: n.state.HP, Dmg: dmg, Killed: killed, Kind: kind, T: nowMS}})
		if killed {
			h.awardKill(ev.shooter, ev.target, true, n.state.Kind, n.state.X, n.state.Z, nowMS)
		}
		return
	} else {
		// ---- player target: fighting is on during the day and the warmup,
		// only the breaks are safe
		if h.match.Phase != "playing" && h.match.Phase != "warmup" {
			return
		}
		target.mu.Lock()
		if !target.state.Alive || target.state.InvulnT > nowMS {
			target.mu.Unlock()
			return
		}
		h.recomputePlayerDerivedStatsLocked(target, nowMS)
		maxHP := target.state.MaxHP
		if target.state.ShieldT > 0 && nowMS >= target.state.ShieldT {
			target.state.Shield = 0
			target.state.ShieldT = 0
		}
		shielded := target.state.Shield > 0 && target.state.ShieldT > nowMS
		absorbed := 0
		if target.state.Shield > 0 {
			if dmg <= target.state.Shield {
				target.state.Shield -= dmg
				absorbed = dmg
				dmg = 0
			} else {
				absorbed = target.state.Shield
				dmg -= target.state.Shield
				target.state.Shield = 0
			}
			if target.state.Shield <= 0 {
				target.state.Shield = 0
				target.state.ShieldT = 0
			}
		}
		if dmg > maxHP {
			dmg = maxHP
		}
		target.state.HP -= dmg
		killed := target.state.HP <= 0
		lockSpell := ""
		lockUntil := int64(0)
		if killed {
			target.state.HP = 0
			target.state.Alive = false
			target.state.RespawnT = nowMS + respawnMS
			target.state.StunUntil = 0
			target.state.Shield = 0
			target.state.ShieldT = 0
			target.state.LockedSpell = ""
			target.state.LockUntil = 0
			target.state.Buffs = nil
			delete(h.auras, ev.target)
			delete(h.orbitals, ev.target)
		} else if !shielded {
			switch kind {
			case "x":
				until := nowMS + xStunBaseMS
				if until > target.state.StunUntil {
					target.state.StunUntil = until
				}
			case "curda_stun":
				until := nowMS + curdaStunMS
				if until > target.state.StunUntil {
					target.state.StunUntil = until
				}
				lockSpell, lockUntil = h.lockRandomSpellLocked(target, nowMS)
			}
		}
		hp := target.state.HP
		tx, tz := target.state.X, target.state.Z
		target.mu.Unlock()
		drain(dmg + absorbed)

		h.broadcastJSON(sMsg{Type: "hit", Data: sHit{Shooter: ev.shooter, Target: ev.target, PID: ev.pid, HP: hp, Dmg: dmg + absorbed, Shield: absorbed > 0, Killed: killed, Kind: kind, T: nowMS}})
		if lockSpell != "" {
			h.broadcastJSON(sMsg{Type: "effect", Data: sEffect{Kind: "lock", Target: ev.target, Spell: lockSpell, Until: lockUntil, X: tx, Z: tz}})
		}
		if killed {
			h.respawnAt[ev.target] = nowMS + respawnMS
			h.awardKill(ev.shooter, ev.target, false, "", tx, tz, nowMS)
		}
	}
}

func pointSegmentDist2(px, pz, ax, az, bx, bz float64) float64 {
	abx := bx - ax
	abz := bz - az
	apx := px - ax
	apz := pz - az
	ab2 := abx*abx + abz*abz
	if ab2 <= 1e-9 {
		dx := px - ax
		dz := pz - az
		return dx*dx + dz*dz
	}
	t := (apx*abx + apz*abz) / ab2
	if t < 0 {
		t = 0
	} else if t > 1 {
		t = 1
	}
	cx := ax + abx*t
	cz := az + abz*t
	dx := px - cx
	dz := pz - cz
	return dx*dx + dz*dz
}

// ------------------------------------------------------------ auras / orbits

func (h *ArenaHub) updateAuras(nowMS int64) {
	for owner, a := range h.auras {
		if nowMS >= a.EndMS {
			delete(h.auras, owner)
			continue
		}
		c, ok := h.clients[owner]
		if !ok {
			delete(h.auras, owner)
			continue
		}
		c.mu.Lock()
		alive := c.state.Alive
		ox := c.state.X
		oz := c.state.Z
		c.mu.Unlock()
		if !alive {
			delete(h.auras, owner)
			continue
		}
		if nowMS < a.NextTick {
			continue
		}
		a.NextTick = nowMS + 500
		healGain := 0.0

		hitR2 := (a.Radius + playerRadius) * (a.Radius + playerRadius)
		for id, t := range h.clients {
			if id == owner {
				continue
			}
			t.mu.Lock()
			tAlive := t.state.Alive
			tx := t.state.X
			tz := t.state.Z
			hpBefore := t.state.HP
			t.mu.Unlock()
			if !tAlive {
				continue
			}
			dx := tx - ox
			dz := tz - oz
			if dx*dx+dz*dz <= hitR2 {
				h.applyHit(hitEvent{shooter: owner, target: id, dmg: a.Damage})
				t.mu.Lock()
				hpAfter := t.state.HP
				t.mu.Unlock()
				if hpBefore > hpAfter {
					healGain += float64(hpBefore-hpAfter) * vLifestealPct
				}
			}
		}
		for id, n := range h.npcs {
			if !n.state.Alive || !npcIsDamageable(n.state.Kind) {
				continue
			}
			r := a.Radius + npcRadius(n.state.Kind)
			dx := n.state.X - ox
			dz := n.state.Z - oz
			if dx*dx+dz*dz <= r*r {
				hpBefore := n.state.HP
				h.applyHit(hitEvent{shooter: owner, target: id, dmg: a.Damage})
				if hpBefore > n.state.HP {
					healGain += float64(hpBefore-n.state.HP) * vLifestealPct
				}
			}
		}
		if healGain > 0 {
			a.HealAcc += healGain
			if a.HealAcc >= 1 {
				add := int(a.HealAcc)
				a.HealAcc -= float64(add)
				c.mu.Lock()
				if c.state.Alive {
					c.state.HP = minInt(c.state.MaxHP, c.state.HP+add)
				}
				c.mu.Unlock()
			}
		}
	}
}

// Orbs move ~14 u/s, so they are checked every server tick; each target can
// only be hit once per fOrbitTickMS so the damage rate stays the same.
func (h *ArenaHub) updateOrbits(nowMS int64) {
	for owner, orb := range h.orbitals {
		if nowMS >= orb.endMS {
			delete(h.orbitals, owner)
			continue
		}
		if orb.lastHit == nil {
			orb.lastHit = map[uint64]int64{}
		}
		c, ok := h.clients[owner]
		if !ok {
			delete(h.orbitals, owner)
			continue
		}
		c.mu.Lock()
		alive := c.state.Alive
		ox := c.state.X
		oz := c.state.Z
		dmgMult := c.derived.DmgMult
		hasDmgBuff := hasActiveBuff(c.state.Buffs, "dmg", nowMS)
		c.mu.Unlock()
		if !alive {
			delete(h.orbitals, owner)
			continue
		}
		theta := float64(nowMS%fOrbitPeriodMS) / float64(fOrbitPeriodMS) * 2.0 * math.Pi
		orbs := [3][2]float64{}
		for i := 0; i < 3; i++ {
			a := theta + float64(i)*(2.0*math.Pi/3.0)
			orbs[i][0] = ox + math.Sin(a)*fOrbitRadius
			orbs[i][1] = oz + math.Cos(a)*fOrbitRadius
		}
		dmg := scaledOutgoingDamage(fOrbitBaseDamage, dmgMult, hasDmgBuff)
		hitR2 := fOrbitHitRadius * fOrbitHitRadius

		for id, t := range h.clients {
			if id == owner || nowMS-orb.lastHit[id] < fOrbitTickMS {
				continue
			}
			t.mu.Lock()
			tAlive := t.state.Alive
			tx := t.state.X
			tz := t.state.Z
			t.mu.Unlock()
			if !tAlive {
				continue
			}
			for _, op := range orbs {
				dx := tx - op[0]
				dz := tz - op[1]
				if dx*dx+dz*dz <= hitR2 {
					orb.lastHit[id] = nowMS
					h.applyHit(hitEvent{shooter: owner, target: id, dmg: dmg})
					break
				}
			}
		}
		for id, n := range h.npcs {
			if !n.state.Alive || !npcIsDamageable(n.state.Kind) || nowMS-orb.lastHit[id] < fOrbitTickMS {
				continue
			}
			r := fOrbitHitRadius + npcRadius(n.state.Kind)
			for _, op := range orbs {
				dx := n.state.X - op[0]
				dz := n.state.Z - op[1]
				if dx*dx+dz*dz <= r*r {
					orb.lastHit[id] = nowMS
					h.applyHit(hitEvent{shooter: owner, target: id, dmg: dmg})
					break
				}
			}
		}
	}
}

// ------------------------------------------------------------ NPC projectiles

func (h *ArenaHub) spawnNPCProjectile(owner uint64, x, z, dx, dz, speed, rng, rad float64, dmg int, kind string) {
	id := h.nextNpcPID.Add(1)
	h.npcProjs[id] = &npcProjectile{ID: id, Owner: owner, X: x, Z: z, DX: dx, DZ: dz, Speed: speed, Range: rng, Rad: rad, Dmg: dmg, Kind: kind}
	h.broadcastJSON(sMsg{Type: "fire", Data: sFire{Owner: owner, PID: id, OX: x, OZ: z, DX: dx, DZ: dz, Kind: kind, T: time.Now().UnixMilli()}})
}

func (h *ArenaHub) updateNPCProjectiles(dt float64) {
	type projTarget struct {
		id   uint64
		x, z float64
	}
	targets := make([]projTarget, 0, len(h.clients))
	for _, c := range h.clients {
		c.mu.Lock()
		if c.state.Alive && c.joined {
			targets = append(targets, projTarget{id: c.id, x: c.state.X, z: c.state.Z})
		}
		c.mu.Unlock()
	}

	for id, pr := range h.npcProjs {
		// Fast shots (the beam does 78 u/s, almost 4 units per tick) are
		// moved in sub-steps so they cannot jump over a player.
		total := pr.Speed * dt
		steps := int(math.Ceil(total / 0.7))
		if steps < 1 {
			steps = 1
		}
		stepLen := total / float64(steps)
		// the server's idea of where a player is lags the player's own screen
		// by up to ~100 ms, so be a little generous rather than tight
		hitR := pr.Rad + playerRadius*1.05
		hitR2 := hitR * hitR
		done := false
		for s := 0; s < steps && !done; s++ {
			pr.X += pr.DX * stepLen
			pr.Z += pr.DZ * stepLen
			pr.Dist += stepLen
			if pr.Dist >= pr.Range || pr.X < -mapHalfX-2 || pr.X > mapHalfX+2 || pr.Z < -mapHalfZ-2 || pr.Z > mapHalfZ+2 {
				done = true
				break
			}
			// the beam goes through walls, everything else stops at them
			if pr.Kind != "reditel_beam" && pointInProjectileBlocker(pr.X, pr.Z, pr.Rad) {
				done = true
				break
			}
			for _, t := range targets {
				dx := t.x - pr.X
				dz := t.z - pr.Z
				if dx*dx+dz*dz <= hitR2 {
					h.applyHit(hitEvent{shooter: pr.Owner, target: t.id, pid: pr.ID, dmg: pr.Dmg})
					done = true
					break
				}
			}
		}
		if done {
			delete(h.npcProjs, id)
		}
	}
}
