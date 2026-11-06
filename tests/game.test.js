// Çalmalı 101 kural testleri. Çalıştırma: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { Okey101, CONFIG, validateSet } = require('../game');

// Okey her testte Kırmızı 5 (c:0, n:5). Renkler: 0 kırmızı, 1 sarı, 2 mavi, 3 siyah.
const OKEY = { c: 0, n: 5 };
let nextId = 1000;
const T = (c, n) => ({ id: nextId++, c, n });
const J = () => T(0, 5);                       // gerçek okey
const F = () => ({ id: nextId++, c: -1, n: 0, fake: true }); // sahte okey
const ids = (arr) => arr.map((t) => t.id);

function setup(n = 2, opts = {}) {
  const g = new Okey101(n, opts);
  g.startHand();
  g.okey = { ...OKEY };
  g.indicator = { id: 9999, c: 0, n: 4 };
  return g;
}
const other = (g, s, k = 1) => (s + k) % g.n;
const names = (r) => r.events.map((e) => e.name);

// 46 + 39 + 42 = 127 puanlık üç per
function hand127() {
  const a = [T(1, 10), T(1, 11), T(1, 12), T(1, 13)];          // sarı 10-13 = 46
  const b = [T(2, 13), T(3, 13), T(0, 13)];                    // 13 grubu = 39
  const c = [T(2, 9), T(2, 10), T(2, 11), T(2, 12)];           // mavi 9-12 = 42
  return { sets: [a, b, c], all: [...a, ...b, ...c] };
}

// ---------- Per doğrulama ----------
test('seri, grup ve çift doğrulama', () => {
  assert.equal(validateSet([T(1, 3), T(1, 4), T(1, 5)], OKEY).type, 'run');
  assert.equal(validateSet([T(1, 12), T(1, 13), T(1, 1)], OKEY).value, 12 + 13 + CONFIG.ACE_HIGH_VALUE);
  assert.equal(validateSet([T(1, 13), T(1, 1), T(1, 2)], OKEY), null, '13-1-2 olmaz');
  assert.equal(validateSet([T(1, 8), T(2, 8), T(3, 8)], OKEY).type, 'group');
  assert.equal(validateSet([T(1, 8), T(1, 8), T(3, 8)], OKEY), null, 'aynı renk grup olmaz');
  assert.equal(validateSet([T(1, 8), T(2, 8), T(3, 8), T(0, 8), T(1, 8)], OKEY), null, 'grup en fazla 4');
  assert.equal(validateSet([T(2, 3), T(2, 3)], OKEY).type, 'pair');
  assert.equal(validateSet([T(2, 3), T(1, 3)], OKEY), null, 'farklı renk çift olmaz');
});

test('okey her yere geçer, sahte okey okeyin yerine geçer', () => {
  assert.equal(validateSet([T(2, 7), J(), T(2, 9)], OKEY).value, 24);
  assert.equal(validateSet([T(2, 3), J()], OKEY).type, 'pair');
  assert.equal(validateSet([F(), T(0, 6), T(0, 7)], OKEY).type, 'run', 'sahte okey = kırmızı 5');
  assert.equal(validateSet([F(), T(1, 6), T(1, 7)], OKEY), null, 'sahte okey joker değildir');
});

// ---------- Açma ----------
test('101 altı açılmaz, 101 üstü açılır', () => {
  const g = setup();
  const s = g.turn;
  const h = hand127();
  g.hands[s] = [...h.all, T(3, 2)];
  assert.match(g.open(s, [ids(h.sets[0])]).error, /101/);
  const r = g.open(s, h.sets.map(ids));
  assert.ok(r.ok);
  assert.equal(g.openType[s], 'seri');
  assert.equal(g.openValue[s], 127);
  assert.equal(g.hands[s].length, 1);
  assert.equal(g.scores[s], 0, '150 altı açışta bonus yok');
});

test('150+ açış -101, 180+ açış -202 yazar', () => {
  for (const [extraSets, bonus] of [[1, 101], [2, 202]]) {
    const g = setup();
    const s = g.turn;
    const h = hand127();
    const more = [[T(0, 11), T(3, 11), T(2, 11)], [T(0, 7), T(3, 7), T(2, 7)]].slice(0, extraSets); // +33, +21
    g.hands[s] = [...h.all, ...more.flat(), T(3, 2)];
    const r = g.open(s, [...h.sets, ...more].map(ids));
    assert.ok(r.ok, r.error);
    assert.equal(g.scores[s], -bonus);
  }
});

test('çift açma: 5 çift gerekir, 7 çift -101 yazar', () => {
  const pairs = (k) => Array.from({ length: k }, (_, i) => { const c = (i % 3) + 1, n = i + 1; return [T(c, n), T(c, n)]; });
  let g = setup(); let s = g.turn; let p = pairs(4);
  g.hands[s] = [...p.flat(), T(3, 13)];
  assert.match(g.open(s, p.map(ids)).error, /5 çift/);

  g = setup(); s = g.turn; p = pairs(7);
  g.hands[s] = [...p.flat(), T(3, 13)];
  assert.ok(g.open(s, p.map(ids)).ok);
  assert.equal(g.openType[s], 'cift');
  assert.equal(g.scores[s], -101);
});

test('katlamalı: rakibin açışının bir fazlası gerekir, eşinki sayılmaz', () => {
  const g = setup(4, { katlamali: true, esli: true });
  g.openType[1] = 'seri'; g.openValue[1] = 130;   // rakip (0'ın rakibi)
  g.openType[2] = 'seri'; g.openValue[2] = 160;   // eş (0 ile 2)
  assert.equal(g.requiredFor(0).seri, 131);
  g.openType[3] = 'cift'; g.openPairs[3] = 6;
  assert.equal(g.requiredFor(0).pairs, 7);
  const k = setup(4, { katlamali: false });
  k.openType[1] = 'seri'; k.openValue[1] = 130;
  assert.equal(k.requiredFor(0).seri, 101, 'katlamasızda sınır sabit');
});

// ---------- İşlek ----------
test('işlek taş ya da okey atan +101 yer', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  g.table.push({ id: 1, owner: o, type: 'run', tiles: [T(2, 9), T(2, 10), T(2, 11)] });
  const islek = T(2, 12);
  g.hands[s] = [islek, T(3, 2), T(3, 3)];
  const r = g.discard(s, islek.id);
  assert.ok(names(r).includes('islek'));
  assert.equal(g.scores[s], CONFIG.ISLEK_PENALTY);

  const g2 = setup();
  const s2 = g2.turn;
  const joker = J();
  g2.hands[s2] = [joker, T(3, 2)];
  const r2 = g2.discard(s2, joker.id);
  assert.equal(r2.events.find((e) => e.name === 'islek').data.joker, true);
  assert.equal(g2.scores[s2], CONFIG.ISLEK_PENALTY);
});

// ---------- Yandan alma ----------
test('yandan alınan taşla açmadan atılamaz, geri bırakılabilir', () => {
  const g = setup();
  const s = g.turn, prev = other(g, s, g.n - 1);
  g.phase = 'draw';
  g.discards[prev] = [T(3, 7)];
  assert.ok(g.take(s).ok);
  assert.equal(g.pendingTake.mode, 'any');
  assert.match(g.discard(s, g.hands[s][0].id).error, /aç ya da geri bırak/);
  assert.ok(g.untake(s).ok);
  assert.equal(g.phase, 'draw');
  assert.equal(g.discards[prev].length, 1);
  assert.ok(g.draw(s).ok);
});

test('çifte giden: sadece çift açar, yandan serbest alır, attığı taş sadece çift için alınır', () => {
  const g = setup();
  const a = g.turn, b = other(g, a);
  assert.ok(g.declareCifte(a).ok);
  const h = hand127();
  g.hands[a] = [...h.all, T(3, 2)];
  assert.match(g.open(a, h.sets.map(ids)).error, /sadece çift/);

  // a'nın attığı taşı b seri için kullanamaz
  const x = T(1, 13);
  g.hands[a].push(x);
  assert.ok(g.discard(a, x.id).ok);
  const hb = hand127();
  g.hands[b] = [...hb.all, T(3, 3)];
  assert.ok(g.take(b).ok);
  assert.equal(g.pendingTake.mode, 'cift');
  assert.match(g.open(b, hb.sets.map(ids)).error, /çift için aldın/);
  assert.ok(g.untake(b).ok);

  // çifte giden yandan alırsa açma zorunluluğu yok
  const g2 = setup();
  const s = g2.turn, prev = other(g2, s, g2.n - 1);
  g2.declareCifte(s);
  g2.phase = 'draw';
  g2.discards[prev] = [T(3, 7)];
  assert.ok(g2.take(s).ok);
  assert.equal(g2.pendingTake, null);
});

test('seri açmış oyuncu çifte gidenin taşını çifti varsa alıp koyar', () => {
  const g = setup();
  const a = g.turn, b = other(g, a);
  g.cifteGoer[a] = true;
  g.openType[b] = 'seri';
  const twin = T(2, 8), x = T(2, 8);
  g.hands[a].push(x);
  assert.ok(g.discard(a, x.id).ok);
  g.hands[b] = [twin, T(1, 1), T(3, 9), T(0, 4)];
  assert.ok(g.take(b).ok);
  assert.equal(g.pendingTake.mode, 'pairLay');
  assert.match(g.discard(b, g.hands[b][1].id).error, /çiftini koy/);
  const before = g.table.length;
  assert.ok(g.open(b, [[twin.id, x.id]]).ok);
  assert.equal(g.table.length, before + 1);
  assert.equal(g.pendingTake, null);
});

// ---------- Puanlama ----------
function finishScenario({ winnerType = 'seri', othersOpened = true, okeyFinish = false, esli = false } = {}) {
  const g = setup(4, { esli });
  const w = g.turn;
  const [o1, o2, o3] = [1, 2, 3].map((k) => other(g, w, k));
  g.openType[w] = winnerType;
  if (othersOpened) { g.openType[o1] = 'seri'; g.openType[o3] = 'seri'; }
  g.hands[o1] = [T(1, 3), T(2, 4)];    // 7
  g.hands[o2] = [T(1, 9)];             // açmadı -> 202
  g.hands[o3] = [T(3, 10)];            // 10
  const last = okeyFinish ? J() : T(1, 9);
  g.hands[w] = [last];
  g.phase = 'discard';
  assert.ok(g.discard(w, last.id).ok);
  return { g, w, o1, o2, o3, p: g.lastResult.penalties };
}

test('puanlama: normal bitiş, kimse açmadan bitiş, çift bitiş, okeyle bitiş', () => {
  let r = finishScenario();
  assert.deepEqual([r.p[r.w], r.p[r.o1], r.p[r.o2], r.p[r.o3]], [-101, 7, 202, 10]);

  r = finishScenario({ othersOpened: false });
  assert.equal(r.g.lastResult.elden, true);
  assert.deepEqual([r.p[r.w], r.p[r.o2]], [-202, 404]);

  r = finishScenario({ winnerType: 'cift' });
  assert.deepEqual([r.p[r.w], r.p[r.o1]], [-202, 14]);

  r = finishScenario({ winnerType: 'cift', othersOpened: false });
  assert.deepEqual([r.p[r.w], r.p[r.o2]], [-404, 808]);

  r = finishScenario({ okeyFinish: true });
  assert.deepEqual([r.p[r.w], r.p[r.o1]], [-202, 14]);
  assert.equal(r.g.scores[r.w], -202, 'son taş okeyse işlek cezası yok');
});

test('eşli: katlar sadece rakiplere, bitenin eşi tek yazar', () => {
  const r = finishScenario({ winnerType: 'cift', esli: true });
  const mate = other(r.g, r.w, 2);
  assert.equal(mate, r.o2);
  assert.equal(r.p[mate], 202, 'eş açmadıysa 202 tek');
  assert.equal(r.p[r.o1], 14, 'rakip x2');
});

test('ödüllü reklam: cezanın yarısı bir kez silinir', () => {
  const r = finishScenario();
  const g = r.g;
  assert.ok(g.refund(r.o3).ok);
  assert.equal(g.scores[r.o3], 5);
  assert.match(g.refund(r.o3).error, /zaten/);
  assert.match(g.refund(r.w).error, /ceza yok/);
});

test('seçilen el sayısı bitince oyun biter', () => {
  const g = new Okey101(2, { hands: 1 });
  g.startHand();
  g.endHand(null, false);
  const r = g.startHand();
  assert.equal(g.over, true);
  assert.ok(names(r).includes('gameOver'));
});

// ---------- Çalma ----------
test('ortadan 2 çek: biri çekiş sayılır, fazla taş kalır; yakalanınca ceza katlanır', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  g.phase = 'draw';
  const L = g.hands[s].length, D = g.deck.length;
  assert.ok(g.steal(s, { kind: 'deck' }).ok);
  assert.equal(g.hands[s].length, L + 2);
  assert.equal(g.deck.length, D - 2);
  assert.equal(g.phase, 'discard');
  assert.equal(g.extra[s], 1);

  let r = g.accuse(o, s);
  assert.equal(r.events[0].name, 'caught');
  assert.equal(r.events[0].data.penalty, 101);
  assert.equal(g.hands[s].length, L + 1, 'fazla taş desteye döndü');
  assert.equal(g.extra[s], 0);

  g.lastAccuse[o] = 0;
  assert.ok(g.steal(s, { kind: 'deck' }).ok);
  r = g.accuse(o, s);
  assert.equal(r.events[0].data.penalty, 202, 'ikinci yakalanış 2 kat');
  assert.equal(g.scores[s], 303);
  assert.equal(g.scores[o], -2 * CONFIG.CATCH_REWARD);
  assert.match(g.steal(s, { kind: 'deck' }).error, /hakkın bitti/);
});

test('fazla taşı yana atınca da süre bitene kadar yakalanır', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  g.steal(s, { kind: 'deck' });
  const dumped = g.hands[s][0];
  assert.ok(g.dump(s, dumped.id).ok);
  assert.equal(g.extra[s], 0);
  assert.equal(g.discards[s].at(-1).id, dumped.id);
  // süre geçti
  g.steals.at(-1).dumpTime -= CONFIG.CATCH_WINDOW_MS + 100;
  assert.equal(g.accuse(o, s).events[0].name, 'falseAccuse');
  assert.equal(g.scores[o], CONFIG.FALSE_ACCUSE_PENALTY);

  // süre içinde yakalanır, atılan taş desteye döner
  const g2 = setup();
  const s2 = g2.turn, o2 = other(g2, s2);
  g2.steal(s2, { kind: 'deck' });
  const d2 = g2.hands[s2][0];
  g2.dump(s2, d2.id);
  const r = g2.accuse(o2, s2);
  assert.equal(r.events[0].name, 'caught');
  assert.equal(g2.deck.at(-1).id, d2.id);
});

test('çöpteki taşla takas ve yakalama', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  const want = T(3, 3);
  g.discards[o] = [T(1, 1), want, T(1, 2)];
  const give = g.hands[s][0];
  assert.ok(g.steal(s, { kind: 'discard', handTileId: give.id, pileSeat: o, pileTileId: want.id }).ok);
  assert.ok(g.hands[s].some((t) => t.id === want.id));
  assert.equal(g.discards[o][1].id, give.id);
  const r = g.accuse(o, s);
  assert.equal(r.events[0].name, 'caught');
  assert.equal(g.discards[o][1].id, want.id, 'taş geri döndü');

  const g2 = setup();
  const s2 = g2.turn, o2 = other(g2, s2);
  const w2 = T(3, 3);
  g2.discards[o2] = [w2];
  g2.steal(s2, { kind: 'discard', handTileId: g2.hands[s2][0].id, pileSeat: o2, pileTileId: w2.id });
  g2.steals.at(-1).time -= CONFIG.CATCH_WINDOW_MS + 100;
  assert.equal(g2.accuse(o2, s2).events[0].name, 'falseAccuse', 'süre geçince yakalanmaz');
});

test('çalma sadece kendi sıranda, suçlama arası bekleme var', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  assert.match(g.steal(o, { kind: 'deck' }).error, /kendi sırandayken/);
  g.accuse(o, s);
  assert.match(g.accuse(o, s).error, /bekle/);
});

// ---------- Ters taş ----------
test('sahte okey: rakip ters taşın yüzünü görmez, itiraz edince 202 ceza ve per bozulur', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  const fake = T(3, 9); // okey değil
  const h = hand127();
  h.sets[2][2] = fake;  // mavi 9-10-[ters]-12
  g.hands[s] = [...h.sets.flat(), T(3, 2)];
  assert.ok(g.open(s, h.sets.map(ids), [fake.id]).ok);
  const setId = g.table[2].id;
  const seen = g.viewFor(o).table[2].tiles[2];
  assert.deepEqual(Object.keys(seen).sort(), ['down', 'id'], 'rakip sadece arkasını görür');
  assert.equal(g.viewFor(s).table[2].tiles[2].n, 9, 'sahibi görür');

  const r = g.challengeDown(o, setId, fake.id);
  assert.equal(r.events[0].name, 'fakeCaught');
  assert.equal(r.events[0].data.penalty, CONFIG.FAKE_OKEY_PENALTY);
  assert.equal(r.events[0].data.broken, true);
  assert.ok(g.hands[s].some((t) => t.id === fake.id && !t.down));
  assert.equal(g.table.length, 2);
});

test('gerçek okey ters konursa itiraz eden ceza yer', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  const joker = J();
  const h = hand127();
  h.sets[2][2] = joker;
  g.hands[s] = [...h.sets.flat(), T(3, 2)];
  assert.ok(g.open(s, h.sets.map(ids), [joker.id]).ok);
  const r = g.challengeDown(o, g.table[2].id, joker.id);
  assert.equal(r.events[0].name, 'fakeMiss');
  assert.equal(g.scores[o], CONFIG.FALSE_ACCUSE_PENALTY);
});

test('dürüst masa: çalma, suçlama ve sahte ters taş kapalı', () => {
  const g = setup(2, { steal: false });
  const s = g.turn, o = other(g, s);
  assert.match(g.steal(s, { kind: 'deck' }).error, /kapalı/);
  assert.match(g.accuse(o, s).error, /kapalı/);
  const fake = T(3, 9);
  g.hands[s] = [T(2, 8), fake, T(2, 10), T(1, 1)];
  assert.match(g.checkSets(s, [[g.hands[s][0].id, fake.id, g.hands[s][2].id]], [fake.id]).error, /sadece okey/);
});

// ---------- Süre ----------
test('süre: deadline kurulur, süresizde kurulmaz', () => {
  const g = setup(2, { turnTime: 15 });
  const left = g.turnDeadline - Date.now();
  assert.ok(left > 14000 && left <= 15000);
  assert.equal(setup(2, { turnTime: 0 }).turnDeadline, 0);
  assert.equal(new Okey101(2, { turnTime: 99 }).opts.turnTime, CONFIG.DEFAULT_TURN_SEC, 'geçersiz süre varsayılana döner');
});

test('süre dolunca otomatik oynanır, üst üste kaçıran otomatik moda geçer', () => {
  const g = setup(2, { turnTime: 15 });
  const s = g.turn;
  let r = g.onTimeout(s);
  assert.deepEqual(names(r).slice(0, 2), ['timeout', 'autoPlayed']);
  assert.notEqual(g.turn, s);
  assert.equal(g.auto[s], false);
  g.onTimeout(g.turn);
  r = g.onTimeout(s);
  assert.equal(g.auto[s], true);
  assert.equal(r.events[0].data.auto, true);
  g.markActive(s);
  assert.equal(g.auto[s], false);
  assert.equal(g.timeouts[s], 0);
});

test('otomatik oynama işlek taşı ve okeyi atmaz', () => {
  const g = setup();
  const s = g.turn, o = other(g, s);
  g.table.push({ id: 1, owner: o, type: 'run', tiles: [T(2, 9), T(2, 10), T(2, 11)] });
  const islek = T(2, 12), joker = J(), safe = T(3, 3);
  g.hands[s] = [islek, joker, safe];
  g.phase = 'discard';
  assert.ok(g.autoPlay(s).ok);
  assert.equal(g.discards[s].at(-1).id, safe.id);
  assert.equal(g.scores[s], 0);
});

test('otomatik oynama yandan alınmış taşı geri bırakıp desteden çeker', () => {
  const g = setup();
  const s = g.turn, prev = other(g, s, g.n - 1);
  g.phase = 'draw';
  g.discards[prev] = [T(3, 7)];
  g.take(s);
  const r = g.autoPlay(s);
  assert.ok(r.ok, r.error);
  assert.ok(names(r).includes('untake'));
  assert.equal(g.discards[prev].length, 1);
});

test('baştan sona otomatik oynanan el hatasız biter', () => {
  for (let k = 0; k < 20; k++) {
    const g = new Okey101(4);
    g.startHand();
    let guard = 0;
    while (g.handActive && guard++ < 500) assert.ok(g.autoPlay(g.turn).ok);
    assert.equal(g.handActive, false);
    const total = g.hands.flat().length + g.discards.flat().length + g.deck.length + 1 + g.table.flatMap((x) => x.tiles).length;
    assert.equal(total, 106, 'taş kaybolmaz, çoğalmaz');
  }
});
