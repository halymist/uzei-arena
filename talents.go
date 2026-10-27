package main

// One connected talent lattice picked between rounds, persisting for the
// week: attack on the left, mobility in the middle, survival on the right,
// 9 rows deep. The three top talents are free; every other one needs ANY of
// its parents in the row above. The middle column is the hub: on even rows it
// can be reached from either side, on odd rows the sides can be reached from
// the middle, so a build can wander between branches. The definition is
// sent to the client so both sides compute the same stats.

type talentNode struct {
	ID       string   `json:"id"`
	Branch   string   `json:"branch"`             // colour only: utok | pohyb | preziti
	Row      int      `json:"row"`                // 0..8, position in the chain
	Col      int      `json:"col"`                // 0..2, branch
	Requires []string `json:"requires,omitempty"` // any one of these unlocks it
	Name     string   `json:"name"`
	Desc     string   `json:"desc"`
	Spell    string   `json:"spell,omitempty"`

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

const talentRows = 9

var talentTree = []talentNode{
	// ---- row 0
	{ID: "u_lokty", Branch: "utok", Row: 0, Col: 0, Name: "Ostré lokty", DmgPct: 0.10, Desc: "+10 % poškození."},
	{ID: "p_boty", Branch: "pohyb", Row: 0, Col: 1, Name: "Rychlé boty", SpeedPct: 0.06, Desc: "+6 % rychlost pohybu."},
	{ID: "z_kuze", Branch: "preziti", Row: 0, Col: 2, Name: "Tlustá kůže", HPPct: 0.20, Desc: "+20 % maximum životů."},

	// ---- row 1
	{ID: "u_strela", Branch: "utok", Row: 1, Col: 0, Requires: []string{"u_lokty", "p_boty"}, Name: "Střela", Spell: "r", Desc: "Sekundu nabíjíš, pak velký projektil skrz zdi."},
	{ID: "p_teleport", Branch: "pohyb", Row: 1, Col: 1, Requires: []string{"p_boty"}, Name: "Teleport", Spell: "e", Desc: "Krátký skok směrem k myši."},
	{ID: "z_stit", Branch: "preziti", Row: 1, Col: 2, Requires: []string{"z_kuze", "p_boty"}, Name: "Štít", Spell: "s", Desc: "30 % max HP jako štít na 5 s, blokuje omráčení."},

	// ---- row 2
	{ID: "u_dopad", Branch: "utok", Row: 2, Col: 0, Requires: []string{"u_strela"}, Name: "Dopad", Spell: "z", Desc: "Plošný výbuch na pozici myši s dohořívající kaluží."},
	{ID: "p_kafe", Branch: "pohyb", Row: 2, Col: 1, Requires: []string{"p_teleport", "u_strela", "z_stit"}, Name: "Dvojité kafe", CdrPct: 0.12, Desc: "-12 % cooldown kouzel."},
	{ID: "z_regen", Branch: "preziti", Row: 2, Col: 2, Requires: []string{"z_stit"}, Name: "Regenerace", RegenPct: 1.0, Desc: "Dvojnásobná regenerace životů."},

	// ---- row 3
	{ID: "u_ruka", Branch: "utok", Row: 3, Col: 0, Requires: []string{"u_dopad", "p_kafe"}, Name: "Rychlá ruka", CdrPct: 0.08, Desc: "-8 % cooldown kouzel."},
	{ID: "p_naraz", Branch: "pohyb", Row: 3, Col: 1, Requires: []string{"p_kafe"}, Name: "Náraz", Spell: "c", Desc: "Výpad vpřed, zasažení jsou omráčeni."},
	{ID: "z_meditace", Branch: "preziti", Row: 3, Col: 2, Requires: []string{"z_regen", "p_kafe"}, Name: "Meditace", ManaPct: 0.25, Desc: "+25 % maximum many."},

	// ---- row 4
	{ID: "u_salva", Branch: "utok", Row: 4, Col: 0, Requires: []string{"u_ruka"}, Name: "Dvojitá salva", SalvaExtra: 3, Desc: "Salva vystřelí o 3 projektily víc."},
	{ID: "p_sprint", Branch: "pohyb", Row: 4, Col: 1, Requires: []string{"p_naraz", "u_ruka", "z_meditace"}, Name: "Dlouhý sprint", SprintPct: 0.5, Desc: "Sprint trvá o polovinu déle."},
	{ID: "z_pole", Branch: "preziti", Row: 4, Col: 2, Requires: []string{"z_meditace"}, Name: "Pole", Spell: "v", Desc: "Aura, která zraňuje okolí a léčí tebe."},

	// ---- row 5
	{ID: "u_tezka", Branch: "utok", Row: 5, Col: 0, Requires: []string{"u_salva", "p_sprint"}, Name: "Těžká Střela", RDmgPct: 0.35, Desc: "Střela dává o 35 % víc."},
	{ID: "p_omraceni", Branch: "pohyb", Row: 5, Col: 1, Requires: []string{"p_sprint"}, Name: "Omráčení", Spell: "x", Desc: "Projektil, který cíl na 1,6 s zastaví."},
	{ID: "z_odolnost", Branch: "preziti", Row: 5, Col: 2, Requires: []string{"z_pole", "p_sprint"}, Name: "Odolnost", HPPct: 0.20, ManaPct: 0.20, Desc: "+20 % životů a +20 % many."},

	// ---- row 6
	{ID: "u_orbit", Branch: "utok", Row: 6, Col: 0, Requires: []string{"u_tezka"}, Name: "Orbit", Spell: "f", Desc: "Tři koule krouží kolem tebe a bijí vše poblíž."},
	{ID: "p_skok", Branch: "pohyb", Row: 6, Col: 1, Requires: []string{"p_omraceni", "u_tezka", "z_odolnost"}, Name: "Dlouhý skok", ERangePct: 0.4, Desc: "Teleport má o 40 % delší dosah."},
	{ID: "z_velky", Branch: "preziti", Row: 6, Col: 2, Requires: []string{"z_odolnost"}, Name: "Velký štít", ShieldPct: 0.25, Desc: "Štít je silnější: 55 % max HP."},

	// ---- row 7
	{ID: "u_premie", Branch: "utok", Row: 7, Col: 0, Requires: []string{"u_orbit", "p_skok"}, Name: "Krvavá prémie", DmgPct: 0.15, Desc: "+15 % poškození."},
	{ID: "p_maraton", Branch: "pohyb", Row: 7, Col: 1, Requires: []string{"p_skok"}, Name: "Maratonec", SpeedPct: 0.08, Desc: "+8 % rychlost pohybu."},
	{ID: "z_upir", Branch: "preziti", Row: 7, Col: 2, Requires: []string{"z_velky", "p_skok"}, Name: "Upír", LifestealPct: 0.10, Desc: "10 % způsobeného poškození se ti vrátí jako životy."},

	// ---- row 8
	{ID: "u_vlna", Branch: "utok", Row: 8, Col: 0, Requires: []string{"u_premie"}, Name: "Vlna", Spell: "g", Desc: "Pomalá rostoucí vlna, prochází nepřáteli."},
	{ID: "p_blesk", Branch: "pohyb", Row: 8, Col: 1, Requires: []string{"p_maraton", "u_premie", "z_upir"}, Name: "Blesk", CdrPct: 0.15, SpeedPct: 0.05, Desc: "-15 % cooldown a +5 % rychlost."},
	{ID: "z_nesmrtelny", Branch: "preziti", Row: 8, Col: 2, Requires: []string{"z_upir"}, Name: "Nesmrtelný", HPPct: 0.30, Desc: "+30 % maximum životů."},
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

// canTakeTalent: root talents are free, anything else needs one of its parents.
func canTakeTalent(owned []string, id string) bool {
	t, ok := talentByID[id]
	if !ok || hasTalent(owned, id) {
		return false
	}
	if len(t.Requires) == 0 {
		return true
	}
	for _, r := range t.Requires {
		if hasTalent(owned, r) {
			return true
		}
	}
	return false
}
