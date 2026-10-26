package main

import (
	"math"
	"math/rand"
)

// The arena is defined once here and shipped to the client in the welcome
// message, so collision and rendering can never drift apart.

type mapRect struct {
	X     float64 `json:"x"` // center
	Z     float64 `json:"z"`
	W     float64 `json:"w"`
	D     float64 `json:"d"`
	H     float64 `json:"h"`
	Kind  string  `json:"kind"` // wall | glass | desk | rack | pillar | printer
	Color string  `json:"color,omitempty"`
}

type mapZone struct {
	Name  string  `json:"name"`
	X     float64 `json:"x"`
	Z     float64 `json:"z"`
	W     float64 `json:"w"`
	D     float64 `json:"d"`
	Color string  `json:"color"`
}

type mapProp struct {
	Kind string  `json:"kind"` // plant | watercooler | whiteboard
	X    float64 `json:"x"`
	Z    float64 `json:"z"`
	Rot  float64 `json:"rot,omitempty"`
}

type mapPoint struct {
	X float64 `json:"x"`
	Z float64 `json:"z"`
}

type mapDef struct {
	HalfX     float64    `json:"halfX"`
	HalfZ     float64    `json:"halfZ"`
	Obstacles []mapRect  `json:"obstacles"`
	Zones     []mapZone  `json:"zones"`
	Props     []mapProp  `json:"props"`
	Spawns    []mapPoint `json:"spawns"`
}

type rect struct{ minX, maxX, minZ, maxZ float64 }

const (
	mapHalfX = 28.0
	mapHalfZ = 18.0
)

// Room interiors used by NPC homes and zone colouring.
var (
	roomReditelna  = rect{-28, -15, -18, -8}
	roomKuchynka   = rect{15, 28, -18, -9}
	roomServerovna = rect{-28, -15, 8, 18}
	roomZasedacka  = rect{15, 28, 8, 18}
)

func (r rect) center() (float64, float64) {
	return (r.minX + r.maxX) / 2, (r.minZ + r.maxZ) / 2
}

func (r rect) contains(x, z float64) bool {
	return x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ
}

func (r rect) shrink(m float64) rect {
	return rect{r.minX + m, r.maxX - m, r.minZ + m, r.maxZ - m}
}

func (r rect) randomPoint() (float64, float64) {
	return r.minX + rand.Float64()*(r.maxX-r.minX), r.minZ + rand.Float64()*(r.maxZ-r.minZ)
}

func zoneFromRect(name string, r rect, color string) mapZone {
	cx, cz := r.center()
	return mapZone{Name: name, X: cx, Z: cz, W: r.maxX - r.minX, D: r.maxZ - r.minZ, Color: color}
}

// seg builds an axis aligned wall segment between two points.
func seg(kind string, x0, z0, x1, z1, thick, h float64) mapRect {
	cx := (x0 + x1) / 2
	cz := (z0 + z1) / 2
	w := math.Abs(x1 - x0)
	d := math.Abs(z1 - z0)
	if w < thick {
		w = thick
	}
	if d < thick {
		d = thick
	}
	return mapRect{X: cx, Z: cz, W: w, D: d, H: h, Kind: kind}
}

func buildArena() mapDef {
	const wt = 0.6 // wall thickness
	const wh = 2.4 // wall height
	obs := []mapRect{}

	// Reditelna (NW): solid walls, doors on the east and south side.
	obs = append(obs,
		seg("wall", -15, -18, -15, -13, wt, wh),
		seg("wall", -15, -10.5, -15, -8, wt, wh),
		seg("wall", -28, -8, -23, -8, wt, wh),
		seg("wall", -20.5, -8, -15, -8, wt, wh),
		mapRect{X: -22.5, Z: -14.5, W: 4.2, D: 1.6, H: 1.0, Kind: "desk", Color: "#5a3f2e"},
	)

	// Kuchynka (NE): walls with doors, a long counter.
	obs = append(obs,
		seg("wall", 15, -18, 15, -13.5, wt, wh),
		seg("wall", 15, -11, 15, -9, wt, wh),
		seg("wall", 15, -9, 19.5, -9, wt, wh),
		seg("wall", 22.5, -9, 28, -9, wt, wh),
		mapRect{X: 22.5, Z: -16.8, W: 9, D: 1.2, H: 1.0, Kind: "desk", Color: "#6b7f8a"},
	)

	// Serverovna (SW): walls with doors, two server racks.
	obs = append(obs,
		seg("wall", -15, 8, -15, 11, wt, wh),
		seg("wall", -15, 13.5, -15, 18, wt, wh),
		seg("wall", -28, 8, -22, 8, wt, wh),
		seg("wall", -19, 8, -15, 8, wt, wh),
		mapRect{X: -25.2, Z: 13.5, W: 1.2, D: 5, H: 2.2, Kind: "rack"},
		mapRect{X: -18.8, Z: 13.5, W: 1.2, D: 5, H: 2.2, Kind: "rack"},
	)

	// Zasedacka (SE): glass walls (shoot through, no walking), big table.
	obs = append(obs,
		seg("glass", 15, 8, 15, 11.5, wt, wh),
		seg("glass", 15, 14, 15, 18, wt, wh),
		seg("glass", 15, 8, 20, 8, wt, wh),
		seg("glass", 23, 8, 28, 8, wt, wh),
		mapRect{X: 21.5, Z: 13, W: 6, D: 2.4, H: 1.0, Kind: "desk", Color: "#4a3a2c"},
	)

	// Open space: desk pairs as low cover, pillars and printers.
	obs = append(obs,
		mapRect{X: -9, Z: -5, W: 3.4, D: 1.4, H: 1.0, Kind: "desk"},
		mapRect{X: -9, Z: 5, W: 3.4, D: 1.4, H: 1.0, Kind: "desk"},
		mapRect{X: 9, Z: -5, W: 3.4, D: 1.4, H: 1.0, Kind: "desk"},
		mapRect{X: 9, Z: 5, W: 3.4, D: 1.4, H: 1.0, Kind: "desk"},
		mapRect{X: 0, Z: -7, W: 1.1, D: 1.1, H: 3.0, Kind: "pillar"},
		mapRect{X: 0, Z: 7, W: 1.1, D: 1.1, H: 3.0, Kind: "pillar"},
		mapRect{X: -4.5, Z: 0, W: 1.0, D: 1.0, H: 1.3, Kind: "printer"},
		mapRect{X: 4.5, Z: 0, W: 1.0, D: 1.0, H: 1.3, Kind: "printer"},
	)

	zones := []mapZone{
		zoneFromRect("Ředitelna", roomReditelna, "#4a3858"),
		zoneFromRect("Kuchyňka", roomKuchynka, "#365a4a"),
		zoneFromRect("Serverovna", roomServerovna, "#2a3d5a"),
		zoneFromRect("Zasedačka", roomZasedacka, "#5a4a36"),
	}

	props := []mapProp{
		{Kind: "plant", X: -13.5, Z: -16.5},
		{Kind: "plant", X: 13.5, Z: -16.5},
		{Kind: "plant", X: -13.5, Z: 16.5},
		{Kind: "plant", X: 13.5, Z: 16.5},
		{Kind: "plant", X: -26.5, Z: -9.5},
		{Kind: "watercooler", X: 26.8, Z: -10.2},
		{Kind: "whiteboard", X: 27.4, Z: 13, Rot: math.Pi / 2},
		{Kind: "whiteboard", X: -27.4, Z: -12, Rot: -math.Pi / 2},
	}

	spawns := []mapPoint{
		{-24, 0}, {24, 0}, {0, -15.5}, {0, 15.5},
		{-11, -14}, {11, -14}, {-11, 14}, {11, 14},
	}

	return mapDef{HalfX: mapHalfX, HalfZ: mapHalfZ, Obstacles: obs, Zones: zones, Props: props, Spawns: spawns}
}

var arena = buildArena()

func (m mapRect) bounds() rect {
	return rect{m.X - m.W/2, m.X + m.W/2, m.Z - m.D/2, m.Z + m.D/2}
}

func (m mapRect) blocksProjectiles() bool {
	return m.Kind == "wall" || m.Kind == "rack" || m.Kind == "pillar"
}

// pointInObstacle: movement collision (every obstacle blocks walking).
func pointInObstacle(x, z, rad float64) bool {
	for _, o := range arena.Obstacles {
		b := o.bounds()
		if x >= b.minX-rad && x <= b.maxX+rad && z >= b.minZ-rad && z <= b.maxZ+rad {
			return true
		}
	}
	return false
}

// pointInProjectileBlocker: only tall solid things stop projectiles.
func pointInProjectileBlocker(x, z, rad float64) bool {
	for _, o := range arena.Obstacles {
		if !o.blocksProjectiles() {
			continue
		}
		b := o.bounds()
		if x >= b.minX-rad && x <= b.maxX+rad && z >= b.minZ-rad && z <= b.maxZ+rad {
			return true
		}
	}
	return false
}

// resolveObstacleMove slides along axis-aligned obstacles. Mirrors the client.
func resolveObstacleMove(prevX, prevZ, newX, newZ, rad float64) (float64, float64) {
	x, z := prevX, prevZ
	if !pointInObstacle(newX, prevZ, rad) {
		x = newX
	}
	if !pointInObstacle(x, newZ, rad) {
		z = newZ
	}
	return x, z
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

// randomFreePos finds a walkable point inside r.
func randomFreePos(r rect, rad float64) (float64, float64) {
	for i := 0; i < 80; i++ {
		x, z := r.randomPoint()
		if !pointInObstacle(x, z, rad) {
			return x, z
		}
	}
	return r.center()
}

var wholeMap = rect{-mapHalfX + 1.5, mapHalfX - 1.5, -mapHalfZ + 1.5, mapHalfZ - 1.5}

// pickSpawn returns the fixed spawn point farthest from every listed enemy
// position, so respawns never land in the middle of a fight.
func pickSpawn(enemies [][2]float64) (float64, float64) {
	bestI := rand.Intn(len(arena.Spawns))
	bestD := -1.0
	for i, s := range arena.Spawns {
		minD := math.MaxFloat64
		for _, e := range enemies {
			d := math.Hypot(e[0]-s.X, e[1]-s.Z)
			if d < minD {
				minD = d
			}
		}
		if len(enemies) == 0 {
			minD = rand.Float64()
		}
		if minD > bestD {
			bestD = minD
			bestI = i
		}
	}
	s := arena.Spawns[bestI]
	// small jitter so two simultaneous respawns do not stack
	return s.X + (rand.Float64()-0.5)*1.2, s.Z + (rand.Float64()-0.5)*1.2
}
