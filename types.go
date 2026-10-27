package main

import (
	"encoding/json"
	"sync"

	"github.com/gorilla/websocket"
)

// ---------------------------------------------------------------- players

type playerState struct {
	ID     uint64  `json:"id"`
	Name   string  `json:"name"`
	Model  int     `json:"model,omitempty"`
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Facing float64 `json:"facing"`

	HP      int `json:"hp"`
	Mana    int `json:"mana"`
	MaxHP   int `json:"maxHp"`
	MaxMana int `json:"maxMana"`

	Score     int      `json:"score"`
	Kills     int      `json:"kills"`
	Deaths    int      `json:"deaths"`
	WeekScore int      `json:"weekScore"`
	HODays    int      `json:"hoDays"`
	TalentPts int      `json:"talentPts"`
	Talents   []string `json:"talents,omitempty"`
	Ready     bool     `json:"ready,omitempty"`

	Shield        int               `json:"shield,omitempty"`
	ShieldT       int64             `json:"shieldUntil,omitempty"`
	InvulnT       int64             `json:"invulnUntil,omitempty"`
	LockedSpell   string            `json:"lockedSpell,omitempty"`
	LockUntil     int64             `json:"lockUntil,omitempty"`
	CollectPickup uint64            `json:"collectPickup,omitempty"`
	CollectUntil  int64             `json:"collectUntil,omitempty"`
	Buffs         []playerBuffState `json:"buffs,omitempty"`
	Alive         bool              `json:"alive"`
	StunUntil     int64             `json:"stunUntil,omitempty"`
	RespawnT      int64             `json:"respawnAt,omitempty"`
}

type playerBuffState struct {
	Kind  string `json:"kind"`
	Until int64  `json:"until"`
}

// playerRecord survives a reconnect within the same week (keyed by name).
type playerRecord struct {
	Talents   []string
	TalentPts int
	HODays    int
	WeekScore int
}

type client struct {
	id   uint64
	hub  *ArenaHub
	conn *websocket.Conn
	send chan []byte

	mu      sync.Mutex
	state   playerState
	derived derivedStats
	hpAcc   float64
	manaAcc float64
	joined  bool
}

// ---------------------------------------------------------------- world

type pickup struct {
	ID        uint64  `json:"id"`
	Kind      string  `json:"kind"` // hp | mana | buff_*
	Value     int     `json:"value,omitempty"`
	X         float64 `json:"x"`
	Z         float64 `json:"z"`
	SpawnAtMS int64   `json:"spawnAtMs"`
	ExpireMS  int64   `json:"expireAtMs"`
}

type npcProjectile struct {
	ID    uint64
	Owner uint64
	X     float64
	Z     float64
	DX    float64
	DZ    float64
	Speed float64
	Range float64
	Dist  float64
	Rad   float64
	Dmg   int
	Kind  string
}

type npcState struct {
	ID        uint64  `json:"id"`
	Kind      string  `json:"kind"`
	Name      string  `json:"name"`
	X         float64 `json:"x"`
	Z         float64 `json:"z"`
	Facing    float64 `json:"facing"`
	Scale     float64 `json:"scale"`
	HP        int     `json:"hp,omitempty"`
	MaxHP     int     `json:"maxHp,omitempty"`
	Alive     bool    `json:"alive"`
	StunUntil int64   `json:"stunUntil,omitempty"`
	RespawnT  int64   `json:"respawnAt,omitempty"`
	Say       string  `json:"say,omitempty"`
	SayUntil  int64   `json:"sayUntil,omitempty"`
	Bounty    int     `json:"bounty,omitempty"`
}

type npcRuntime struct {
	state            npcState
	home             rect
	homeOnly         bool
	vx               float64
	vz               float64
	hpAcc            float64
	nextDirMS        int64
	nextSayMS        int64
	nextSayReadyMS   int64
	nextHitMS        int64
	nextBeamMS       int64
	beamFireMS       int64
	beamDX           float64
	beamDZ           float64
	burstEndMS       int64
	nextChargeMS     int64
	chargeEndMS      int64
	chargeHitDone    bool
	pauseToMS        int64
	aggroID          uint64
	stunUntilMS      int64
	forcedAggroMS    int64
	nextBarrageMS    int64
	nextBarrageReady int64
	barrageShots     int
	barrageTarget    uint64
	nextStunMS       int64
	nextSalvaMS      int64
	salvaShots       int
	nextSalvaShot    int64
	healAcc          map[uint64]float64
	path             []mapPoint
	pathIdx          int
	pathGoalX        float64
	pathGoalZ        float64
	nextPathMS       int64
}

// ---------------------------------------------------------------- match

type matchState struct {
	Phase        string `json:"phase"` // idle | warmup | playing | intermission | weekend
	Day          int    `json:"day"`   // 0..4
	Week         int    `json:"week"`
	PhaseEndsAt  int64  `json:"phaseEndsAt"`
	ScoreTarget  int    `json:"scoreTarget"`
	LeaderID     uint64 `json:"leaderId,omitempty"`
	LastWinnerID uint64 `json:"lastWinnerId,omitempty"`
	WeekWinnerID uint64 `json:"weekWinnerId,omitempty"`
}

type standing struct {
	ID        uint64 `json:"id"`
	Name      string `json:"name"`
	Model     int    `json:"model"`
	Score     int    `json:"score"`
	Kills     int    `json:"kills"`
	Deaths    int    `json:"deaths"`
	HODays    int    `json:"hoDays"`
	WeekScore int    `json:"weekScore"`
	PtsAward  int    `json:"ptsAward"`
}

// ---------------------------------------------------------------- inbound

type cMsg struct {
	Type string          `json:"type"`
	Data json.RawMessage `json:"data,omitempty"`
}

type cJoin struct {
	Name  string `json:"name"`
	Model int    `json:"model,omitempty"`
}

type cState struct {
	X      float64 `json:"x"`
	Z      float64 `json:"z"`
	Facing float64 `json:"facing"`
}

type cFire struct {
	PID  uint64  `json:"pid"`
	OX   float64 `json:"ox"`
	OZ   float64 `json:"oz"`
	DX   float64 `json:"dx"`
	DZ   float64 `json:"dz"`
	Kind string  `json:"kind"`
}

type cHit struct {
	PID    uint64 `json:"pid"`
	Target uint64 `json:"target"`
	Dmg    int    `json:"dmg"`
}

type cCast struct {
	Kind string   `json:"kind"`
	X    *float64 `json:"x,omitempty"`
	Z    *float64 `json:"z,omitempty"`
}

type cPickup struct {
	ID uint64 `json:"id"`
}

type cTalent struct {
	ID string `json:"id"`
}

type cCollect struct {
	ID    uint64 `json:"id"`
	Start bool   `json:"start"`
}

type collectEvent struct {
	player uint64
	pickup uint64
	start  bool
}

type collectState struct {
	pickupID uint64
	startMS  int64
	baseX    float64
	baseZ    float64
}

type cReady struct {
	Ready bool `json:"ready"`
}

// ---------------------------------------------------------------- outbound

type sMsg struct {
	Type string      `json:"type"`
	Data interface{} `json:"data,omitempty"`
}

type sWelcome struct {
	Build     int64        `json:"build"` // server start time; a change means "reload me"
	YouID     uint64       `json:"youId"`
	TickRate  int          `json:"tickRate"`
	StartHP   int          `json:"startHp"`
	StartMana int          `json:"startMana"`
	NowMS     int64        `json:"nowMs"`
	Map       mapDef       `json:"map"`
	Talents   []talentNode `json:"talents"`
	Match     matchState   `json:"match"`
	RespawnMS int64        `json:"respawnMs"`
}

type sSnapshot struct {
	T       int64         `json:"t"`
	Players []playerState `json:"players"`
	Pickups []pickup      `json:"pickups"`
	Npcs    []npcState    `json:"npcs"`
	Match   matchState    `json:"match"`
}

type sFire struct {
	Owner uint64  `json:"owner"`
	PID   uint64  `json:"pid"`
	OX    float64 `json:"ox"`
	OZ    float64 `json:"oz"`
	DX    float64 `json:"dx"`
	DZ    float64 `json:"dz"`
	Kind  string  `json:"kind"`
	T     int64   `json:"t"`
}

type sHit struct {
	Shooter uint64 `json:"shooter"`
	Target  uint64 `json:"target"`
	PID     uint64 `json:"pid"`
	HP      int    `json:"hp"`
	Dmg     int    `json:"dmg"`
	Shield  bool   `json:"shield,omitempty"`
	Killed  bool   `json:"killed"`
	Kind    string `json:"kind,omitempty"`
	T       int64  `json:"t"`
}

type sKill struct {
	Killer     uint64 `json:"killer"`
	Victim     uint64 `json:"victim"`
	VictimNPC  bool   `json:"victimNpc,omitempty"`
	KillerNPC  bool   `json:"killerNpc,omitempty"`
	Points     int    `json:"points"`
	Bonus      string `json:"bonus,omitempty"` // leader | boss
	KillerName string `json:"killerName"`
	VictimName string `json:"victimName"`
	T          int64  `json:"t"`
}

type sRound struct {
	Match     matchState `json:"match"`
	Standings []standing `json:"standings,omitempty"`
	WinnerID  uint64     `json:"winnerId,omitempty"`
	Reason    string     `json:"reason,omitempty"` // target | time
	T         int64      `json:"t"`
}

type sLeave struct {
	ID uint64 `json:"id"`
}

type sEffect struct {
	Kind   string  `json:"kind"` // lock | heal | leader | score | cast
	Target uint64  `json:"target"`
	Spell  string  `json:"spell,omitempty"`
	Until  int64   `json:"until,omitempty"`
	Amount int     `json:"amount,omitempty"`
	X      float64 `json:"x,omitempty"`
	Z      float64 `json:"z,omitempty"`
}

// ---------------------------------------------------------------- hub events

type stateUpdate struct {
	id     uint64
	x, z   float64
	facing float64
}

type hitEvent struct {
	shooter uint64
	target  uint64
	pid     uint64
	dmg     int
}

type castEvent struct {
	id     uint64
	kind   string
	hasPos bool
	x, z   float64
}

type fireEvent struct {
	shooter uint64
	pid     uint64
	ox, oz  float64
	dx, dz  float64
	kind    string
}

type pickEvent struct {
	player uint64
	pickup uint64
}

type talentEvent struct {
	player uint64
	id     string
}

type readyEvent struct {
	player uint64
	ready  bool
}

type joinEvent struct {
	c     *client
	name  string
	model int
}

type playerAura struct {
	Owner    uint64
	EndMS    int64
	NextTick int64
	Radius   float64
	Damage   int
	HealAcc  float64
}

type playerOrbit struct {
	owner   uint64
	endMS   int64
	nextMS  int64
	lastHit map[uint64]int64 // per target, so each is hit at most once per tick window
}
