# superhry · Kancelářská aréna

Free-for-all arena pro kamarády. Go server (websocket) + Three.js klient, bez buildu.

## Spuštění

```
go build -o superhry.exe . && ./superhry.exe
```

Otevři http://localhost:8080/ (server vypíše i LAN adresy pro ostatní). `PORT=9000` změní port.

## Herní smyčka

- **Pracovní týden** = 5 dnů (Pondělí–Pátek). Každý den je jedno kolo na 4 minuty; vyhrává nejvíc bodů.
- Body: zabití hráče **+1**, zabití vedoucího **+2**, zabití **Ředitele** v jeho kanceláři **+2**. Body ale nepadají do kapsy: na místě smrti zůstane mince a sebere ji ten, kdo na ní 2 s stojí (pohyb nebo omráčení sběr přeruší). Mince po 45 s zmizí.
- Vítěz dne dostane **Home Office den**. Kdo jich má po pátku nejvíc, vyhrává týden; pak se všechno resetuje.
- **Přestávka** mezi dny trvá, dokud všichni nekliknou Připraven: každý dostane 2 talentové body, poražená polovina 3. Talenty vydrží celý týden a přežijí i reconnect (podle jména).
- **Talentový strom**: jedna propojená mřížka 3×9 (útok vlevo, pohyb uprostřed, přežití vpravo). Tři horní talenty jsou volné, každý další vyžaduje kterýkoli ze svých rodičů v řadě nad sebou (šipky); prostřední sloupec se kříží s krajními, takže se dá mezi větvemi přecházet. Odemykají kouzla i pasivní bonusy. Start: útok (LMB), Salva (Q), Sprint (W). Kouzla se na klávesy Q W E R D F přiřazují o přestávce (klik + klávesa, nebo přetažení).

## Postavy

Hráči i NPC jsou riggované low-poly modely z `web/models/characters.glb` (skript `tools/blender/characters.py`, zdroj `assets/characters.blend`): jeden humanoidní rig sdílený hráčem, Náměstkem, Ředitelem, Sofií a Čurdou, druhý pro Psa. Klipy (idle, walk, run, attack, cast, channel, dash, hit, stun, death, pickup, shout, heal, phone, boss_idle; pes má vlastní) se v `characters.js` prolínají: stav postavy vybírá smyčku, kouzla a zásahy spouštějí jednorázové klipy. Server posílá `effect: cast`, aby kouzla animovali i ostatní klienti.

- **Náměstek** hledá Martina. Martin je ten, kdo vede, takže Náměstek za ním běží přes celou mapu a křičí.
- **Ředitel** sedí v Ředitelně, střílí a občas vypálí paprsek. Za jeho hlavu jsou 2 body, vrací se po 40 s.
- **Sofie** je v Kuchyňce a léčí každého, kdo stojí vedle ní.
- **Čurda** omračuje a na 7 s ti zabaví jedno kouzlo („Seberu vám počítač“).
- **Pes** kouše, kdo se přiblíží.

## Mapa

Definovaná jednou v `arena_map.go` a posílaná klientovi ve `welcome`. Zdi zastaví pohyb i střely, sklo (Zasedačka) a stoly jen pohyb. Stoly mají `Variant` (pair / exec / meeting / counter), podle které klient rozmístí monitory a židle; rekvizity (`props`) mohou mít `Y` pro věci stojící na lince.

## Grafika (Blender)

Kancelář se kreslí z malé sady low-poly dílů `web/models/office_kit.glb` (zeď, sklo, stůl, židle, monitor, rack, sloup, tiskárna, kytka, barel, tabule, kávovar, mikrovlnka). Klient (`scene.js`) každý díl instancuje podle mapy: zdi natahuje na délku, dveře dopočítá z mezer mezi zdmi, stoly obloží podle varianty.

Sada vzniká skriptem `tools/blender/office_kit.py`, který ji postaví od nuly, uloží `assets/office_kit.blend` (zdroj k ruční úpravě) a vyexportuje glb; postavy stejně dělá `tools/blender/characters.py` (společné helpery jsou v `tools/blender/kitlib.py`):

```
blender --background --python tools/blender/office_kit.py
blender --background --python tools/blender/characters.py
```

Postavy: rotace v klipech se zadávají kolem světových os klidové pózy (viz hlavička skriptu), všechny varianty sdílejí jeden armature a musí zůstat v počátku; v .blend je viditelný jen hráč, ostatní se zapínají v outlineru.

Díly mají počátek na podlaze uprostřed, délku v X, hloubku v Y, výšku v Z; přední strana směřuje do -Y (v hře k obrazovce). Nový díl = nová funkce `build_*` v `PIECES` a `place('nazev', ...)` v `scene.js`. Soubor `web/` se vkládá do binárky (`go:embed`), po změně modelu je potřeba znovu `go build`.

## Kód

- `hub.go` websocket + hlavní smyčka, `match.go` kola/týden/skóre/talenty, `combat.go` zásahy a kouzla, `npc.go` AI postav, `talents.go` strom, `config.go` čísla.
- `web/js/`: `net.js` zprávy, `spells.js` kouzla a projektily, `entities.js` modely, `fx.js` efekty, `audio.js` syntetizované zvuky, `hud.js` UI a přestávka, `scene.js` mapa a kamera.
- Klient je autoritativní pro vlastní pohyb a zásahy vlastních střel (žádný anticheat, hra pro kamarády). Server rozhoduje o HP, skóre, talentech a průběhu kola.

## Smoke test

```
SUPERHRY_FAST=1 SUPERHRY_FAST_MS=20000 SUPERHRY_PASSIVE_NPC=1 PORT=8099 ./superhry.exe
WS_URL=ws://localhost:8099/ws/arena node tools/smoke.mjs
```

Dva falešní hráči odehrají zkrácené kolo a ověří skóre, bonusy, Home Office den, talenty a reconnect.
