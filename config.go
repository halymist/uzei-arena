package main

import (
	"os"
	"strconv"
)

// Gameplay constants. Spell numbers that the client also needs live in
// web/js/config.js and must be kept in sync by hand (the client predicts,
// the server decides).
const (
	tickRate     = 20 // Hz, server snapshot broadcast rate
	maxPlayers   = 16
	startHP      = 100
	startMana    = 100
	hitDamage    = 24 // fallback damage for a hit without an explicit amount
	respawnMS    = 4000
	maxNameLen   = 16
	sendQueueLen = 64

	hpRegenPctPerSec   = 0.04
	manaRegenPctPerSec = 0.06

	pickupSpawnMS         = 15000 // hp/mana orbs are rare; coins are the thing to fight over
	maxPickups            = 3
	maxBuffPickups        = 1
	buffSpawnMS           = 60000
	pickupRadius          = 1.2
	pickupLifeMS          = 30000
	pointDropLifeMS       = 45000
	pointCollectMS        = 1200  // standing on a coin this long collects it
	coinSpawnMS           = 25000 // a neutral coin appears somewhere on the floor
	maxFloorCoins         = 2
	pointCollectRange     = 1.6
	pointCollectMoveBreak = 0.5
	buffPickupLifeMS      = 30000
	buffDurationMS        = 30000
	buffStatPct           = 0.20
	buffDmgPct            = 0.10

	spawnInvulnMS = 2000
	playerRadius  = 0.6

	// --- match structure (the work week) ---
	daysPerWeek      = 5
	warmupMS         = 12000 // between days
	firstWarmupMS    = 60000 // new lobby: a minute of free play, then reset and Monday starts
	roundMS          = 240000
	allReadyGraceMS  = 3000 // countdown once everyone is ready in a break
	scoreTargetBase  = 10
	pointsKill       = 1
	pointsKillLeader = 2
	pointsKillBoss   = 2
	pointsKillNPC    = 1 // Pes, Náměstek, Čurda drop a coin too
	talentPtsPerDay  = 2
	talentPtsCatchUp = 1

	// --- NPC tuning ---
	npcSayMS           = 7000
	npcSayInternalCDMS = 9000
	npcRespawnMS       = 20000 // long enough that NPCs are not a coin farm
	bossRespawnMS      = 40000
	npcForcedAggroMS   = 10000

	dogHP          = 100
	dogAggroRange  = 11.0
	dogDeaggroRng  = 16.0
	dogTouchRange  = 1.15
	dogTouchDmg    = 14
	dogHitCDMS     = 900
	dogChaseSpeed  = 4.7
	dogWanderSpeed = 2.45

	namestekHP             = 210
	namestekRegenPS        = 11.0
	namestekAggroRng       = 12.0
	namestekDeaggroRng     = 18.0
	namestekTouchRange     = 1.18
	namestekTouchDmg       = 18
	namestekHitCDMS        = 850
	namestekChaseSpeed     = 3.6
	namestekHuntSpeed      = 4.6
	namestekWanderSpeed    = 1.65
	namestekChargeRange    = 9.4
	namestekChargeMinRange = 2.0
	namestekChargeSpeed    = 14.0
	namestekChargeMS       = 280
	namestekChargeCDMS     = 7000
	namestekChargeHitR     = 1.28
	namestekChargeDmg      = 26
	namestekChargeStunMS   = 550

	reditelHP           = 520
	reditelRegenPS      = 14.0
	reditelMissileSpeed = 12.0
	reditelMissileRange = 11.0
	reditelMissileRad   = 0.22
	reditelMissileDmg   = 8
	reditelShotCDMS     = 140
	reditelBurstMS      = 3000
	reditelPauseMS      = 1700
	reditelBeamCDMS     = 9000
	reditelBeamSpeed    = 78.0
	reditelBeamRange    = 44.0
	reditelBeamRad      = 0.92
	reditelBeamDmg      = 55
	reditelBeamWindupMS = 800
	reditelBarrageCDMS  = 18000
	reditelBarrageGapMS = 120

	sofieWanderSpeed = 1.6
	sofieHealRange   = 2.4
	sofieHealPctPS   = 0.06
	sofieTalkCDMS    = 9000

	curdaHP              = 200
	curdaRegenPS         = 8.0
	curdaAggroRng        = 13.0
	curdaDeaggroRng      = 19.0
	curdaWanderSpeed     = 1.7
	curdaKiteSpeed       = 4.2
	curdaPreferredDist   = 9.0
	curdaStunSpeed       = 22.0
	curdaStunRange       = 18.0
	curdaStunRad         = 0.60
	curdaStunDmg         = 12
	curdaStunMS          = 800
	curdaStunCDMS        = 7000
	curdaLockMS          = 7000
	curdaSalvaSpeed      = 24.0
	curdaSalvaRange      = 16.0
	curdaSalvaRad        = 0.30
	curdaSalvaDmg        = 7
	curdaSalvaShots      = 5
	curdaSalvaIntervalMS = 110
	curdaSalvaCDMS       = 3250

	// --- spells (server side numbers) ---
	chargeCost       = 30
	chargeDashDist   = 10.2
	chargeHitRadius  = 1.2
	chargeDamageBase = 16
	chargeStunMS     = 850

	vCost = 55
	xCost = 45
	zCost = 50
	sCost = 40
	fCost = 45
	gCost = 40
	qCost = 35
	wCost = 30
	eCost = 50
	rCost = 75

	fOrbitDurationMS = 6000
	fOrbitTickMS     = 250
	fOrbitPeriodMS   = 2500
	fOrbitRadius     = 5.5
	fOrbitHitRadius  = 1.15
	fOrbitBaseDamage = 17

	shieldDurationMS = 5000
	shieldPctMaxHP   = 0.30

	vBaseRadius   = 5.7
	vLifestealPct = 0.10
	vBaseDamage   = 8
	vDurationMS   = 5000

	xStunBaseMS = 1600
)

// fastMode shortens every phase so a whole round can be smoke-tested in
// seconds. Enabled with SUPERHRY_FAST=1 (optionally SUPERHRY_FAST_MS=n).
var fastMode = os.Getenv("SUPERHRY_FAST") == "1"

// passiveNPC keeps the office crew from attacking anyone (smoke tests).
var passiveNPC = os.Getenv("SUPERHRY_PASSIVE_NPC") == "1"

func phaseDuration(base int64) int64 {
	if !fastMode {
		return base
	}
	if v := os.Getenv("SUPERHRY_FAST_MS"); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil && n > 0 {
			return n
		}
	}
	return 6000
}

// warmupDuration: in fast mode the countdown is always short.
func warmupDuration(base int64) int64 {
	if !fastMode {
		return base
	}
	return 4000
}
