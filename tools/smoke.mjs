// Smoke test: two fake clients play one shortened round.
// Run the server with SUPERHRY_FAST=1 SUPERHRY_FAST_MS=20000 SUPERHRY_PASSIVE_NPC=1 first.
const URL = process.env.WS_URL || 'ws://localhost:8080/ws/arena';
const results = [];
function check(name, ok, info = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${info ? ' - ' + info : ''}`);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function makeClient(name) {
  const c = { name, id: 0, ws: null, snap: null, msgs: [], welcome: null };
  c.ws = new WebSocket(URL);
  c.send = o => c.ws.send(JSON.stringify(o));
  c.ready = new Promise((resolve, reject) => {
    c.ws.addEventListener('open', () => c.send({ type: 'join', data: { name, model: 1 } }));
    c.ws.addEventListener('error', reject);
    c.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.type === 'welcome') { c.welcome = m.data; c.id = m.data.youId; resolve(); }
      else if (m.type === 'snap') c.snap = m.data;
      else c.msgs.push(m);
    });
  });
  c.me = () => c.snap?.players.find(p => p.id === c.id);
  c.waitPhase = async (phase, timeout = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (c.snap?.match?.phase === phase) return true;
      await sleep(50);
    }
    return false;
  };
  c.waitMsg = async (type, pred = () => true, timeout = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const m = c.msgs.find(x => x.type === type && pred(x.data));
      if (m) return m.data;
      await sleep(30);
    }
    return null;
  };
  return c;
}

async function main() {
  const A = makeClient('Alice');
  const B = makeClient('Bob');
  await Promise.all([A.ready, B.ready]);
  check('welcome received', A.id > 0 && B.id > 0, `ids ${A.id},${B.id}`);
  check('map shipped in welcome', Array.isArray(A.welcome.map?.obstacles) && A.welcome.map.obstacles.length > 10);
  check('talent tree shipped', Array.isArray(A.welcome.talents) && A.welcome.talents.length === 27);

  // keep both alive with position updates
  const posLoop = setInterval(() => {
    if (A.ws.readyState === 1) A.send({ type: 'state', data: { x: 20, z: 10.5, facing: 0 } });
    if (B.ws.readyState === 1) B.send({ type: 'state', data: { x: 21.2, z: 10.5, facing: 0 } });
  }, 100);

  check('warmup starts with players', await A.waitPhase('warmup', 5000), `phase=${A.snap?.match?.phase}`);
  for (let i = 0; i < 40 && (A.snap?.players.length || 0) < 2; i++) await sleep(50);
  check('two players in snapshot', A.snap.players.length === 2);
  check('round starts', await A.waitPhase('playing', 20000));
  await sleep(2600); // spawn invulnerability

  // damage is ignored during warmup; now Alice kills Bob with 5 autoattacks
  for (let i = 0; i < 5; i++) {
    A.send({ type: 'fire', data: { pid: 100 + i, ox: 0, oz: 0, dx: 1, dz: 0, kind: 'aa' } });
    A.send({ type: 'hit', data: { pid: 100 + i, target: B.id, dmg: 24 } });
    await sleep(40);
  }
  const kill1 = await A.waitMsg('kill', d => d.victim === B.id);
  check('kill broadcast after 5 hits', !!kill1, JSON.stringify(kill1));
  check('kill worth 1 point', kill1?.points === 1 && kill1?.killerName === 'Alice');
  const hitMsg = A.msgs.find(m => m.type === 'hit' && m.data.target === B.id && m.data.shooter === A.id);
  check('hit message carries dmg', hitMsg?.data?.dmg === 24, JSON.stringify(hitMsg?.data));
  await sleep(200);
  check('kills/deaths updated in snapshot', A.me()?.kills === 1 && B.me()?.deaths === 1, `A=${JSON.stringify(A.me())}`);
  // points lie on the floor: Alice stands on the coin for 2 s
  await sleep(150);
  const coin = A.snap.pickups.find(p => p.kind === 'point');
  check('kill drops a coin', !!coin && coin.value === 1, JSON.stringify(coin));
  check('score not awarded before collecting', A.me()?.score === 0);
  A.send({ type: 'collect', data: { id: coin.id, start: true } });
  const scored = await A.waitMsg('effect', d => d.kind === 'score' && d.target === A.id, 4000);
  check('coin collected after standing on it', !!scored && scored.amount === 1, JSON.stringify(scored));
  const leader = await A.waitMsg('effect', d => d.kind === 'leader' && d.target === A.id, 2000);
  check('Alice becomes leader (Martin)', !!leader && A.snap.match.leaderId === A.id);

  // Bob respawns (4s) and kills the leader for 2 points (one big hit so NPC
  // chip damage on the idle dummies cannot interfere)
  {
    const t0 = Date.now();
    while (Date.now() - t0 < 15000) {
      const a = A.me(), b = B.me();
      const serverNow = A.snap.t;
      if (a?.alive && b?.alive && (a.invulnUntil || 0) < serverNow && (b.invulnUntil || 0) < serverNow) break;
      await sleep(50);
    }
  }
  B.msgs.length = 0;
  const aliveBefore = A.me()?.alive;
  B.send({ type: 'fire', data: { pid: 200, ox: 2, oz: 0, dx: -1, dz: 0, kind: 'aa' } });
  B.send({ type: 'hit', data: { pid: 200, target: A.id, dmg: 500 } });
  const kill2 = await B.waitMsg('kill', d => d.victim === A.id);
  if (!kill2) console.log(`  (Alice alive before shot: ${aliveBefore}, phase ${A.snap?.match?.phase})`);
  check('leader kill broadcast', !!kill2, JSON.stringify(kill2));
  check('leader kill worth 2 points', kill2?.points === 2 && kill2?.bonus === 'leader');
  await sleep(150);
  const coin2 = B.snap.pickups.find(p => p.kind === 'point' && p.value === 2);
  check('leader kill drops one coin worth 2', !!coin2, JSON.stringify(B.snap.pickups));
  B.send({ type: 'collect', data: { id: coin2?.id || 0, start: true } });
  await sleep(600);
  for (let i = 0; i < 4; i++) { // moving away interrupts (repeated so the position loop cannot mask it)
    B.send({ type: 'state', data: { x: 23.5, z: 10.5, facing: 0 } });
    await sleep(70);
  }
  await sleep(200);
  check('moving interrupts collection', !(B.me()?.collectPickup) && B.me()?.score === 0);
  B.send({ type: 'collect', data: { id: coin2?.id || 0, start: true } });
  const scored2 = await B.waitMsg('effect', d => d.kind === 'score' && d.target === B.id, 4000);
  check('coin worth 2 collected', !!scored2 && scored2.amount === 2, JSON.stringify(scored2));

  // boss bounty: hitting Reditel for a huge amount kills him (damage is clamped to max HP)
  B.msgs.length = 0;
  B.send({ type: 'hit', data: { pid: 0, target: 1002, dmg: 9999 } });
  const boss = await B.waitMsg('kill', d => d.victim === 1002, 2000);
  check('boss kill gives bounty', !!boss && boss.points === 2 && boss.bonus === 'boss', JSON.stringify(boss));
  await sleep(200);
  check('boss drops a coin worth 2 far away', !!B.snap.pickups.find(p => p.kind === 'point' && p.value === 2), JSON.stringify(B.snap.pickups));
  check('Bob score is 2', B.me()?.score === 2, `score=${B.me()?.score}`);

  // talent during round: nothing to spend yet
  B.send({ type: 'talent', data: { id: 'u1' } });
  await sleep(200);
  check('no talent without points', !(B.me()?.talents || []).length);

  // round end
  const roundEnd = await A.waitMsg('round', d => d.match.phase === 'intermission', 15000);
  check('intermission reached', !!roundEnd);
  check('standings have award points', roundEnd?.standings?.length === 2 && roundEnd.standings.every(s => s.ptsAward >= 2), JSON.stringify(roundEnd?.standings));
  check('Bob wins the day', roundEnd?.winnerId === B.id);
  await sleep(200);
  check('winner got a Home Office day', B.me()?.hoDays === 1 && A.me()?.hoDays === 0);
  check('loser got catch-up point', A.me()?.talentPts === 3 && B.me()?.talentPts === 2, `A=${A.me()?.talentPts} B=${B.me()?.talentPts}`);

  // talents
  A.send({ type: 'talent', data: { id: 'u_orbit' } }); // needs Strela: rejected
  A.send({ type: 'talent', data: { id: 'z_odolnost' } }); // requires Stit: rejected
  A.send({ type: 'talent', data: { id: 'u_lokty' } });
  A.send({ type: 'talent', data: { id: 'z_stit' } });
  await sleep(250);
  check('talent prerequisites enforced', JSON.stringify(A.me()?.talents) === JSON.stringify(['u_lokty', 'z_stit']) && A.me()?.talentPts === 1, `talents=${JSON.stringify(A.me()?.talents)} pts=${A.me()?.talentPts}`);
  A.send({ type: 'talent', data: { id: 'z_kuze' } });
  await sleep(250);
  check('hp talent raises max hp', A.me()?.maxHp === 120 && A.me()?.talentPts === 0, `maxHp=${A.me()?.maxHp}`);

  // ready both -> next day starts early
  A.send({ type: 'ready', data: { ready: true } });
  B.send({ type: 'ready', data: { ready: true } });
  const nextDay = await A.waitMsg('round', d => d.match.phase === 'warmup' && d.match.day === 1, 6000);
  check('all ready skips to next day', !!nextDay, `phase=${A.snap?.match?.phase} day=${A.snap?.match?.day}`);
  await sleep(200);
  check('talents persist into next day', JSON.stringify(A.me()?.talents) === JSON.stringify(['u_lokty', 'z_stit', 'z_kuze']));
  check('scores reset for new day', A.me()?.score === 0 && B.me()?.score === 0);

  // reconnect keeps the record
  A.ws.close();
  await sleep(300);
  const A2 = makeClient('Alice');
  await A2.ready;
  await sleep(400);
  check('reconnect restores talents by name', JSON.stringify(A2.me()?.talents) === JSON.stringify(['u_lokty', 'z_stit', 'z_kuze']) && A2.me()?.maxHp === 120, JSON.stringify(A2.me()?.talents));

  clearInterval(posLoop);
  A2.ws.close();
  B.ws.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
