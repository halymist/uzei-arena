package main

// One unified talent tree, picked between rounds, persisting for the week.
// Layout is a 7-column grid: attack on the left, mobility in the middle,
// survival on the right. Row 0 is free; every other talent needs its parent
// (drawn as an arrow). The definition is sent to the client so both sides
// compute the same stats.

type talentNode struct {
	ID       string `json:"id"`
	Branch   string `json:"branch"` // colour only: utok | pohyb | preziti
	Row      int    `json:"row"`    // 0..4
	Col      int    `json:"col"`    // 0..6
	Requires string `json:"requires,omitempty"`
	Name     string `json:"name"`
	Desc     string `json:"desc"`
	Spell    string `json:"spell,omitempty"`

	DmgPct       float64 `json:"dmgPct,omitempty"`
	SpeedPct     float64 `json:"speedPct,omitempty"`
	CdrPct       float64 `json:"cdrPct,omitempty"`
	HPPct        float64 `json:"hpPct,omitempty"`
	ManaPct      float64 `json:"manaPct,omitempty"`
	RegenPct     float64 `json:"regenPct,omitempty"`
	SprintPct    float64 `json:"sprintPct,omitempty"`
	SalvaExtra   int     `json:"salvaExtra,omitempty"`
	RDmgPct      float64 `json:"rDmgPct,omitempty"`
	ERangePct    float64 `json:"eRangePct,omitempty"`
	LifestealPct float64 `json:"lifestealPct,omitempty"`
	ShieldPct    float64 `json:"shieldPct,omitempty"`
}

const talentRows = 5

var talentTree = []talentNode{
	// ---- row 0: free picks
	{ID: "u_lokty", Branch: "utok", Row: 0, Col: 0, Name: "Ostré lokty", DmgPct: 0.10, Desc: "+10 % poškození."},
	{ID: "u_strela", Branch: "utok", Row: 0, Col: 1, Name: "Střela", Spell: "r", Desc: "Sekundu nabíjíš, pak velký projektil skrz zdi."},
	{ID: "p_boty", Branch: "pohyb", Row: 0, Col: 2, Name: "Rychlé boty", SpeedPct: 0.06, Desc: "+6 % rychlost pohybu."},
	{ID: "p_teleport", Branch: "pohyb", Row: 0, Col: 3, Name: "Teleport", Spell: "e", Desc: "Krátký skok směrem k myši."},
	{ID: "p_sprint", Branch: "pohyb", Row: 0, Col: 4, Name: "Dlouhý sprint", SprintPct: 0.5, Desc: "Sprint trvá o polovinu déle."},
	{ID: "z_stit", Branch: "preziti", Row: 0, Col: 5, Name: "Štít", Spell: "s", Desc: "30 % max HP jako štít na 5 s, blokuje omráčení."},
	{ID: "z_kuze", Branch: "preziti", Row: 0, Col: 6, Name: "Tlustá kůže", HPPct: 0.20, Desc: "+20 % maximum životů."},

	// ---- row 1
	{ID: "u_dopad", Branch: "utok", Row: 1, Col: 0, Requires: "u_lokty", Name: "Dopad", Spell: "z", Desc: "Plošný výbuch na pozici myši s dohořívající kaluží."},
	{ID: "u_ruka", Branch: "utok", Row: 1, Col: 1, Requires: "u_strela", Name: "Rychlá ruka", CdrPct: 0.08, Desc: "-8 % cooldown kouzel."},
	{ID: "p_naraz", Branch: "pohyb", Row: 1, Col: 2, Requires: "p_boty", Name: "Náraz", Spell: "c", Desc: "Výpad vpřed, zasažení jsou omráčeni."},
	{ID: "p_kafe", Branch: "pohyb", Row: 1, Col: 3, Requires: "p_teleport", Name: "Dvojité kafe", CdrPct: 0.12, Desc: "-12 % cooldown kouzel."},
	{ID: "z_meditace", Branch: "preziti", Row: 1, Col: 4, Requires: "p_sprint", Name: "Meditace", ManaPct: 0.25, Desc: "+25 % maximum many."},
	{ID: "z_regen", Branch: "preziti", Row: 1, Col: 5, Requires: "z_stit", Name: "Regenerace", RegenPct: 1.0, Desc: "Dvojnásobná regenerace životů."},
	{ID: "z_pole", Branch: "preziti", Row: 1, Col: 6, Requires: "z_kuze", Name: "Pole", Spell: "v", Desc: "Aura, která zraňuje okolí a léčí tebe."},

	// ---- row 2
	{ID: "u_salva", Branch: "utok", Row: 2, Col: 0, Requires: "u_dopad", Name: "Dvojitá salva", SalvaExtra: 3, Desc: "Salva vystřelí o 3 projektily víc."},
	{ID: "u_orbit", Branch: "utok", Row: 2, Col: 1, Requires: "u_strela", Name: "Orbit", Spell: "f", Desc: "Tři koule krouží kolem tebe a bijí vše poblíž."},
	{ID: "p_omraceni", Branch: "pohyb", Row: 2, Col: 3, Requires: "p_teleport", Name: "Omráčení", Spell: "x", Desc: "Projektil, který cíl na 1,6 s zastaví."},
	{ID: "p_maraton", Branch: "pohyb", Row: 2, Col: 4, Requires: "p_sprint", Name: "Maratonec", SpeedPct: 0.08, Desc: "+8 % rychlost pohybu."},
	{ID: "z_odolnost", Branch: "preziti", Row: 2, Col: 5, Requires: "z_stit", Name: "Odolnost", HPPct: 0.20, ManaPct: 0.20, Desc: "+20 % životů a +20 % many."},
	{ID: "z_upir", Branch: "preziti", Row: 2, Col: 6, Requires: "z_pole", Name: "Upír", LifestealPct: 0.10, Desc: "10 % způsobeného poškození se ti vrátí jako životy."},

	// ---- row 3
	{ID: "u_premie", Branch: "utok", Row: 3, Col: 0, Requires: "u_salva", Name: "Krvavá prémie", DmgPct: 0.15, Desc: "+15 % poškození."},
	{ID: "u_tezka", Branch: "utok", Row: 3, Col: 1, Requires: "u_strela", Name: "Těžká Střela", RDmgPct: 0.35, Desc: "Střela dává o 35 % víc."},
	{ID: "p_skok", Branch: "pohyb", Row: 3, Col: 2, Requires: "p_teleport", Name: "Dlouhý skok", ERangePct: 0.4, Desc: "Teleport má o 40 % delší dosah."},
	{ID: "z_velky", Branch: "preziti", Row: 3, Col: 4, Requires: "z_stit", Name: "Velký štít", ShieldPct: 0.25, Desc: "Štít je silnější: 55 % max HP."},

	// ---- row 4: capstones
	{ID: "u_vlna", Branch: "utok", Row: 4, Col: 1, Requires: "u_orbit", Name: "Vlna", Spell: "g", Desc: "Pomalá rostoucí vlna, prochází nepřáteli."},
	{ID: "p_blesk", Branch: "pohyb", Row: 4, Col: 3, Requires: "p_omraceni", Name: "Blesk", CdrPct: 0.15, SpeedPct: 0.05, Desc: "-15 % cooldown a +5 % rychlost."},
	{ID: "z_nesmrtelny", Branch: "preziti", Row: 4, Col: 5, Requires: "z_odolnost", Name: "Nesmrtelný", HPPct: 0.30, Desc: "+30 % maximum životů."},
}

var talentByID = func() map[string]talentNode {
	m := make(map[string]talentNode, len(talentTree))
	for _, t := range talentTree {
		m[t.ID] = t
	}
	return m
}()

// starting kit every player always has
var baseSpells = map[string]bool{"aa": true, "q": true, "w": true}

type derivedStats struct {
	DmgMult    float64
	SpeedMult  float64
	CdrMult    float64
	HPMult     float64
	ManaMult   float64
	RegenMult  float64
	SprintMult float64
	RDmgMult   float64
	ERangeMult float64
	Lifesteal  float64
	ShieldPct  float64
	SalvaExtra int
	Spells     map[string]bool
}

func deriveStats(owned []string) derivedStats {
	d := derivedStats{DmgMult: 1, SpeedMult: 1, CdrMult: 1, HPMult: 1, ManaMult: 1, RegenMult: 1, SprintMult: 1, RDmgMult: 1, ERangeMult: 1, ShieldPct: shieldPctMaxHP, Spells: map[string]bool{}}
	for k := range baseSpells {
		d.Spells[k] = true
	}
	for _, id := range owned {
		t, ok := talentByID[id]
		if !ok {
			continue
		}
		d.DmgMult += t.DmgPct
		d.SpeedMult += t.SpeedPct
		d.CdrMult -= t.CdrPct
		d.HPMult += t.HPPct
		d.ManaMult += t.ManaPct
		d.RegenMult += t.RegenPct
		d.SprintMult += t.SprintPct
		d.RDmgMult += t.RDmgPct
		d.ERangeMult += t.ERangePct
		d.Lifesteal += t.LifestealPct
		d.ShieldPct += t.ShieldPct
		d.SalvaExtra += t.SalvaExtra
		if t.Spell != "" {
			d.Spells[t.Spell] = true
		}
	}
	if d.CdrMult < 0.4 {
		d.CdrMult = 0.4
	}
	return d
}

func hasTalent(owned []string, id string) bool {
	for _, o := range owned {
		if o == id {
			return true
		}
	}
	return false
}

// canTakeTalent: root talents are free, anything else needs its parent.
func canTakeTalent(owned []string, id string) bool {
	t, ok := talentByID[id]
	if !ok || hasTalent(owned, id) {
		return false
	}
	if t.Requires != "" && !hasTalent(owned, t.Requires) {
		return false
	}
	return true
}
