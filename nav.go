package main

import (
	"container/heap"
	"math"
)

// A coarse navigation grid for NPCs: half-unit cells, a cell is walkable
// when a circle of navClearance fits there. Chasers run A* when they have
// no line of sight to their target and then follow the waypoints, which
// stops them from parking against walls and desks.

const (
	navCell      = 0.5
	navClearance = 0.6
)

type navGrid struct {
	cols, rows int
	walk       []bool
}

var nav = buildNav()

func buildNav() *navGrid {
	g := &navGrid{cols: int(math.Round(2 * mapHalfX / navCell)), rows: int(math.Round(2 * mapHalfZ / navCell))}
	g.walk = make([]bool, g.cols*g.rows)
	for j := 0; j < g.rows; j++ {
		for i := 0; i < g.cols; i++ {
			x, z := g.center(i, j)
			inside := x > -mapHalfX+navClearance && x < mapHalfX-navClearance && z > -mapHalfZ+navClearance && z < mapHalfZ-navClearance
			g.walk[j*g.cols+i] = inside && !pointInObstacle(x, z, navClearance)
		}
	}
	return g
}

func (g *navGrid) center(i, j int) (float64, float64) {
	return -mapHalfX + (float64(i)+0.5)*navCell, -mapHalfZ + (float64(j)+0.5)*navCell
}

func (g *navGrid) cellOf(x, z float64) (int, int) {
	i := int(math.Floor((x + mapHalfX) / navCell))
	j := int(math.Floor((z + mapHalfZ) / navCell))
	if i < 0 {
		i = 0
	}
	if j < 0 {
		j = 0
	}
	if i >= g.cols {
		i = g.cols - 1
	}
	if j >= g.rows {
		j = g.rows - 1
	}
	return i, j
}

func (g *navGrid) walkable(i, j int) bool {
	return i >= 0 && j >= 0 && i < g.cols && j < g.rows && g.walk[j*g.cols+i]
}

// nearestWalkable finds the closest free cell around (i,j).
func (g *navGrid) nearestWalkable(i, j int) (int, int, bool) {
	if g.walkable(i, j) {
		return i, j, true
	}
	for r := 1; r <= 4; r++ {
		for dj := -r; dj <= r; dj++ {
			for di := -r; di <= r; di++ {
				if g.walkable(i+di, j+dj) {
					return i + di, j + dj, true
				}
			}
		}
	}
	return 0, 0, false
}

// lineFree: can a circle of radius rad travel straight from a to b?
func lineFree(ax, az, bx, bz, rad float64) bool {
	d := math.Hypot(bx-ax, bz-az)
	steps := int(math.Ceil(d / 0.3))
	if steps < 1 {
		return true
	}
	for s := 1; s <= steps; s++ {
		t := float64(s) / float64(steps)
		if pointInObstacle(ax+(bx-ax)*t, az+(bz-az)*t, rad) {
			return false
		}
	}
	return true
}

type navNode struct {
	idx  int
	f, g float64
}

type navHeap []navNode

func (h navHeap) Len() int            { return len(h) }
func (h navHeap) Less(a, b int) bool  { return h[a].f < h[b].f }
func (h navHeap) Swap(a, b int)       { h[a], h[b] = h[b], h[a] }
func (h *navHeap) Push(x interface{}) { *h = append(*h, x.(navNode)) }
func (h *navHeap) Pop() interface{} {
	old := *h
	n := len(old)
	v := old[n-1]
	*h = old[:n-1]
	return v
}

// findPath returns waypoints (world coordinates) from a to b, already
// smoothed so that consecutive points have line of sight. Empty when the
// target is unreachable.
func (g *navGrid) findPath(ax, az, bx, bz float64) []mapPoint {
	si, sj := g.cellOf(ax, az)
	si, sj, ok := g.nearestWalkable(si, sj)
	if !ok {
		return nil
	}
	ti, tj := g.cellOf(bx, bz)
	ti, tj, ok = g.nearestWalkable(ti, tj)
	if !ok {
		return nil
	}
	start := sj*g.cols + si
	goal := tj*g.cols + ti
	if start == goal {
		return []mapPoint{{bx, bz}}
	}

	gScore := make(map[int]float64, 256)
	from := make(map[int]int, 256)
	closed := make(map[int]bool, 256)
	gScore[start] = 0
	h := &navHeap{}
	heap.Init(h)
	heur := func(idx int) float64 {
		i, j := idx%g.cols, idx/g.cols
		return math.Hypot(float64(i-ti), float64(j-tj))
	}
	heap.Push(h, navNode{idx: start, f: heur(start)})
	dirs := [8][3]float64{{1, 0, 1}, {-1, 0, 1}, {0, 1, 1}, {0, -1, 1}, {1, 1, math.Sqrt2}, {1, -1, math.Sqrt2}, {-1, 1, math.Sqrt2}, {-1, -1, math.Sqrt2}}
	found := false
	for h.Len() > 0 && len(closed) < 6000 {
		cur := heap.Pop(h).(navNode)
		if closed[cur.idx] {
			continue
		}
		if cur.idx == goal {
			found = true
			break
		}
		closed[cur.idx] = true
		ci, cj := cur.idx%g.cols, cur.idx/g.cols
		for _, d := range dirs {
			ni, nj := ci+int(d[0]), cj+int(d[1])
			if !g.walkable(ni, nj) {
				continue
			}
			// no corner cutting
			if d[0] != 0 && d[1] != 0 && (!g.walkable(ci+int(d[0]), cj) || !g.walkable(ci, cj+int(d[1]))) {
				continue
			}
			nidx := nj*g.cols + ni
			if closed[nidx] {
				continue
			}
			ng := gScore[cur.idx] + d[2]
			if old, seen := gScore[nidx]; !seen || ng < old {
				gScore[nidx] = ng
				from[nidx] = cur.idx
				heap.Push(h, navNode{idx: nidx, g: ng, f: ng + heur(nidx)})
			}
		}
	}
	if !found {
		return nil
	}
	// reconstruct
	cells := []int{goal}
	for cur := goal; cur != start; {
		cur = from[cur]
		cells = append(cells, cur)
	}
	pts := make([]mapPoint, 0, len(cells)+1)
	for k := len(cells) - 1; k >= 0; k-- {
		x, z := g.center(cells[k]%g.cols, cells[k]/g.cols)
		pts = append(pts, mapPoint{x, z})
	}
	// finish on the exact goal only when that last step is clear
	last := pts[len(pts)-1]
	if lineFree(last.X, last.Z, bx, bz, navClearance) {
		pts = append(pts, mapPoint{bx, bz})
	}
	return smoothPath(pts)
}

// smoothPath keeps only the waypoints needed: from each kept point jump to
// the farthest later point that is reachable in a straight line.
func smoothPath(pts []mapPoint) []mapPoint {
	if len(pts) <= 2 {
		return pts
	}
	out := []mapPoint{pts[0]}
	i := 0
	for i < len(pts)-1 {
		j := len(pts) - 1
		for j > i+1 && !lineFree(pts[i].X, pts[i].Z, pts[j].X, pts[j].Z, navClearance) {
			j--
		}
		out = append(out, pts[j])
		i = j
	}
	return out
}

// chaseMove steers an NPC toward (tx,tz): straight when the way is clear,
// otherwise along a path that is refreshed every so often.
func (h *ArenaHub) chaseMove(n *npcRuntime, tx, tz, speed float64, nowMS int64) {
	if lineFree(n.state.X, n.state.Z, tx, tz, navClearance) {
		n.path = nil
		dx := tx - n.state.X
		dz := tz - n.state.Z
		d := math.Hypot(dx, dz)
		if d > 0.001 {
			n.vx = dx / d * speed
			n.vz = dz / d * speed
		}
		return
	}
	goalMoved := math.Hypot(tx-n.pathGoalX, tz-n.pathGoalZ) > 1.5
	if n.path == nil || nowMS >= n.nextPathMS || goalMoved {
		n.path = nav.findPath(n.state.X, n.state.Z, tx, tz)
		n.pathIdx = 0
		n.pathGoalX, n.pathGoalZ = tx, tz
		n.nextPathMS = nowMS + 600
		// skip the first waypoint if we are already past it
		if len(n.path) > 1 && math.Hypot(n.path[0].X-n.state.X, n.path[0].Z-n.state.Z) < 0.4 {
			n.pathIdx = 1
		}
	}
	if len(n.path) == 0 {
		// unreachable: at least face the target and stop pushing into the wall
		n.vx, n.vz = 0, 0
		return
	}
	for n.pathIdx < len(n.path)-1 && math.Hypot(n.path[n.pathIdx].X-n.state.X, n.path[n.pathIdx].Z-n.state.Z) < 0.45 {
		n.pathIdx++
	}
	wp := n.path[n.pathIdx]
	dx := wp.X - n.state.X
	dz := wp.Z - n.state.Z
	d := math.Hypot(dx, dz)
	if d > 0.001 {
		n.vx = dx / d * speed
		n.vz = dz / d * speed
	}
}
