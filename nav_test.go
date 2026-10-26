package main

import "testing"

// Paths must exist between rooms (through the doors) and around desks.
func TestNavPaths(t *testing.T) {
	cases := []struct {
		name           string
		ax, az, bx, bz float64
	}{
		{"office to centre", -22, -12, 0, 0},
		{"centre to kitchen", 0, 0, 22, -14},
		{"server room to meeting room", -22, 13, 22, 16.5},
		{"across the desks", -9, -8, -9, -2},
		{"corner to corner", -26, -16, 26, 16},
	}
	for _, c := range cases {
		p := nav.findPath(c.ax, c.az, c.bx, c.bz)
		if len(p) == 0 {
			t.Fatalf("%s: no path", c.name)
		}
		// every leg must be walkable in a straight line
		x, z := c.ax, c.az
		for _, w := range p {
			if !lineFree(x, z, w.X, w.Z, navClearance-0.05) {
				t.Fatalf("%s: leg %.1f,%.1f -> %.1f,%.1f crosses an obstacle", c.name, x, z, w.X, w.Z)
			}
			x, z = w.X, w.Z
		}
		if x != c.bx || z != c.bz {
			t.Fatalf("%s: path does not end at the goal", c.name)
		}
	}
	// a goal inside furniture ends on the nearest free spot instead
	p := nav.findPath(0, 0, 22, 14)
	if len(p) == 0 {
		t.Fatal("no path toward the meeting table")
	}
	if end := p[len(p)-1]; pointInObstacle(end.X, end.Z, navClearance) {
		t.Fatalf("path ends inside an obstacle at %.1f,%.1f", end.X, end.Z)
	}
	// a direct line through a wall must not be free
	if lineFree(-22, -12, 0, 0, navClearance) {
		t.Fatal("line through the office wall reported free")
	}
}
