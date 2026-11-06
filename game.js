// Çalmalı 101 Okey - oyun mantığı (sunucu otoriter)
// Tüm kurallar ve ayarlar burada. İstemci sadece kendi elini görür.
// Puanlama: CEZA puanı toplanır, oyun sonunda EN DÜŞÜK puan kazanır.
const crypto = require('crypto');

const CONFIG = {
  TOTAL_HANDS: 9,             // kaç el oynanacak
  HAND_SIZE: 21,              // başlayan 22 taş alır
  OPEN_MIN: 101,              // seri açmak için gereken toplam
  OPEN_MIN_PAIRS: 5,          // çift açmak için gereken çift sayısı
  WIN_BONUS: 101,             // biten oyuncu -101 yazar
  NOT_OPENED_PENALTY: 202,    // hiç açamayan
  ISLEK_PENALTY: 101,         // işlenebilir taş ya da okey atma cezası
  ACE_HIGH_VALUE: 1,          // 12-13-1 perindeki 1'in puan değeri
  SERI_SILER: 150,            // bu ve üstüyle seri açan -101 yazar
  SERI_DOUBLE_SILER: 180,     // bu ve üstüyle seri açan -202 yazar
  CIFT_SILER: 7,              // bu kadar çiftle açan -101 yazar
  CIFT_DOUBLE_SILER: 9,       // bu kadar çiftle açan -202 yazar
  // Çalma
  STEAL_LIMIT: 2,             // bir elde en fazla kaç kez çalınabilir
  CATCH_WINDOW_MS: 6000,      // çaldıktan sonra yakalanabileceği süre
  CAUGHT_PENALTY: 101,        // yakalanan hırsızın ilk cezası; aynı elde her yakalanışta 2 katı
  CATCH_REWARD: 50,           // yakalayanın puanından düşülür
  FAKE_OKEY_PENALTY: 202,     // okey olmayan taşı ters koyup yakalanan; aynı elde her seferinde 2 katı
  FALSE_ACCUSE_PENALTY: 50,   // boşuna "Yakaladım!" diyenin cezası
  ACCUSE_COOLDOWN_MS: 3000,
  DECK_HINT_CHANCE: 0.6,      // desteden çalınca diğerlerine ipucu gitme ihtimali
  // Süre
  TURN_TIME_OPTIONS: [0, 15, 30, 45], // saniye; 0 = süresiz
  DEFAULT_TURN_SEC: 30,
  AFK_AFTER_TIMEOUTS: 2,      // üst üste bu kadar süre kaçıran otomatik oynanır (bir hamle yapınca kontrol geri gelir)
  AUTO_DELAY_MS: 1500,        // otomatik oynananın hamlesi için bekleme
  OFFLINE_GRACE_MS: 10000,    // bağlantısı kopanın yeniden bağlanması için beklenen süre
  // Reklam
  REWARD_REFUND_RATIO: 0.5,   // ödüllü reklam: son elin cezasının ne kadarı silinir
};

function createTiles() {
  const tiles = [];
  let id = 0;
  for (let c = 0; c < 4; c++)
    for (let n = 1; n <= 13; n++)
      for (let k = 0; k < 2; k++) tiles.push({ id: id++, c, n });
  tiles.push({ id: id++, c: -1, n: 0, fake: true });
  tiles.push({ id: id++, c: -1, n: 0, fake: true });
  return tiles;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const k = crypto.randomInt(i + 1);
    [arr[i], arr[k]] = [arr[k], arr[i]];
  }
  return arr;
}

const nextValue = (n) => (n === 13 ? 1 : n + 1);

// Okey joker olur, sahte okey okeyin kimliğine bürünür
function norm(t, okey) {
  if (t.down) return { j: true };   // ters çevrilmiş taş okey gibi sayılır (gerçekten okey olmasa bile)
  if (!t.fake && t.c === okey.c && t.n === okey.n) return { j: true };
  if (t.fake) return { c: okey.c, n: okey.n };
  return { c: t.c, n: t.n };
}

// Bir peri doğrular. Seri, verilen sıraya göre okunur (okeyin yerini oyuncu belirler).
// Dönüş: { type: 'run'|'group'|'pair', value } ya da null
function validateSet(tiles, okey) {
  const N = tiles.map((t) => norm(t, okey));
  const real = N.filter((x) => !x.j);
  if (!real.length) return null;

  if (tiles.length === 2) {
    if (real.length === 1 || (real[0].c === real[1].c && real[0].n === real[1].n))
      return { type: 'pair', value: real[0].n * 2 };
    return null;
  }
  if (tiles.length < 3) return null;

  const options = [];
  // Grup: aynı sayı, farklı renk, 3-4 taş
  if (tiles.length <= 4 && real.every((x) => x.n === real[0].n)) {
    const cs = new Set(real.map((x) => x.c));
    if (cs.size === real.length) options.push({ type: 'group', value: real[0].n * tiles.length });
  }
  // Seri: aynı renk, ardışık. 1, 13'ten sonra gelebilir (12-13-1), 13-1-2 olmaz.
  if (real.every((x) => x.c === real[0].c)) {
    for (const aceHigh of [false, true]) {
      const vals = N.map((x) => (x.j ? null : aceHigh && x.n === 1 ? 14 : x.n));
      const f = vals.findIndex((v) => v !== null);
      const s = vals[f] - f;
      const e = s + tiles.length - 1;
      if (s < 1 || e > 14) continue;
      if (!vals.every((v, i) => v === null || v === s + i)) continue;
      let value = 0;
      for (let v = s; v <= e; v++) value += v === 14 ? CONFIG.ACE_HIGH_VALUE : v;
      options.push({ type: 'run', value });
      break;
    }
  }
  if (!options.length) return null;
  return options.sort((a, b) => b.value - a.value)[0];
}

// ---------- Açabilir mi? (yandan alma kontrolü için) ----------
function makeCounts(tiles, okey) {
  const counts = Array.from({ length: 4 }, () => Array(15).fill(0));
  let j = 0;
  for (const t of tiles) {
    const x = norm(t, okey);
    if (x.j) j++; else counts[x.c][x.n]++;
  }
  return { counts, j };
}

// Eldeki taşlarla yapılabilecek en yüksek seri/grup toplamı
function bestValue(counts, j, memo) {
  const key = counts.map((r) => r.join('')).join('|') + '#' + j;
  if (memo.has(key)) return memo.get(key);
  let c = -1, v = -1;
  outer: for (let cc = 0; cc < 4; cc++)
    for (let n = 1; n <= 13; n++)
      if (counts[cc][n] > 0) { c = cc; v = n; break outer; }
  if (c === -1) { memo.set(key, 0); return 0; }

  counts[c][v]--;
  let best = bestValue(counts, j, memo); // bu taşı kullanma

  const others = [0, 1, 2, 3].filter((x) => x !== c && counts[x][v] > 0);
  for (let mask = 0; mask < 1 << others.length; mask++) {
    const ch = others.filter((_, i) => (mask >> i) & 1);
    for (let size = 3; size <= 4; size++) {
      const need = size - 1 - ch.length;
      if (need < 0 || need > j) continue;
      ch.forEach((x) => counts[x][v]--);
      best = Math.max(best, v * size + bestValue(counts, j - need, memo));
      ch.forEach((x) => counts[x][v]++);
    }
  }

  const tryRun = (from, to, aceHigh) => {
    let jl = j, val = 0;
    const rec = (x) => {
      if (x > to) { best = Math.max(best, val + bestValue(counts, jl, memo)); return; }
      const pts = x === 14 ? CONFIG.ACE_HIGH_VALUE : x;
      if ((aceHigh && x === 14) || (!aceHigh && x === v)) { val += pts; rec(x + 1); val -= pts; return; }
      if (counts[c][x] > 0) { counts[c][x]--; val += pts; rec(x + 1); val -= pts; counts[c][x]++; }
      if (jl > 0) { jl--; val += pts; rec(x + 1); val -= pts; jl++; }
    };
    rec(from);
  };
  for (let a = v; a >= Math.max(1, v - j); a--)
    for (let b = Math.max(v, a + 2); b <= 13; b++) tryRun(a, b, false);
  if (v === 1) for (let a = 12; a >= 2; a--) tryRun(a, 14, true);

  counts[c][v]++;
  memo.set(key, best);
  return best;
}

// forced (yandan alınacak, elde olmayan) taşı kullanarak OPEN_MIN'e ulaşan bir seri açılış var mı?
function canOpenSeriWith(handTiles, okey, forced, need = CONFIG.OPEN_MIN) {
  const { counts, j } = makeCounts([...handTiles, forced], okey);
  const f = norm(forced, okey);
  const memo = new Map();
  const templates = [];
  for (let n = 1; n <= 13; n++)
    for (let mask = 0; mask < 16; mask++) {
      const cs = [0, 1, 2, 3].filter((x) => (mask >> x) & 1);
      if (cs.length >= 3) templates.push(cs.map((c) => ({ c, n })));
    }
  for (let c = 0; c < 4; c++)
    for (let a = 1; a <= 12; a++)
      for (let b = a + 2; b <= 14; b++) {
        if (b === 14 && a < 2) continue;
        const t = [];
        for (let x = a; x <= b; x++) t.push({ c, n: x });
        templates.push(t);
      }

  let found = false;
  const fill = (slots, i, jl, used, val) => {
    if (found) return;
    if (i === slots.length) {
      if (used && val + bestValue(counts, jl, memo) >= need) found = true;
      return;
    }
    const s = slots[i];
    const realN = s.n === 14 ? 1 : s.n;
    const pts = s.n === 14 ? CONFIG.ACE_HIGH_VALUE : s.n;
    if (counts[s.c][realN] > 0) {
      counts[s.c][realN]--;
      fill(slots, i + 1, jl, used || (!f.j && f.c === s.c && f.n === realN), val + pts);
      counts[s.c][realN]++;
    }
    if (jl > 0) fill(slots, i + 1, jl - 1, used || !!f.j, val + pts);
  };
  for (const t of templates) { fill(t, 0, j, false, 0); if (found) break; }
  return found;
}

// forced taşı bir çiftte kullanarak OPEN_MIN_PAIRS çifte ulaşılıyor mu?
function canOpenCiftWith(handTiles, okey, forced, need = CONFIG.OPEN_MIN_PAIRS) {
  const { counts, j } = makeCounts([...handTiles, forced], okey);
  let pairs = 0, singles = 0;
  for (let c = 0; c < 4; c++)
    for (let n = 1; n <= 13; n++) { pairs += Math.floor(counts[c][n] / 2); singles += counts[c][n] % 2; }
  const maxPairs = pairs + Math.min(singles, j);
  const f = norm(forced, okey);
  if (f.j) return singles >= 1 && maxPairs >= need;
  if (counts[f.c][f.n] >= 2) return maxPairs >= need;
  return j >= 1 && maxPairs >= need;
}

// Taş eldeki bir taşla ya da okeyle çift oluyor mu?
function formsPair(handTiles, okey, tile) {
  const f = norm(tile, okey);
  return handTiles.some((t) => {
    const x = norm(t, okey);
    if (x.j) return !f.j;
    return !f.j && x.c === f.c && x.n === f.n;
  });
}

const ok = (events = []) => ({ ok: true, events });
const fail = (error) => ({ ok: false, error });

class Okey101 {
  // opts: { esli: 0-2 / 1-3 eş, katlamali: rakip kaç ile açtıysa fazlasıyla açmak gerekir }
  constructor(seatCount, opts = {}) {
    this.n = seatCount;
    this.opts = {
      esli: !!opts.esli && seatCount === 4,
      katlamali: !!opts.katlamali,
      steal: opts.steal !== false,                       // false: dürüst oyun, çalma kapalı
      hands: Number(opts.hands) > 0 ? Number(opts.hands) : CONFIG.TOTAL_HANDS,
      turnTime: CONFIG.TURN_TIME_OPTIONS.includes(Number(opts.turnTime)) ? Number(opts.turnTime) : CONFIG.DEFAULT_TURN_SEC,
    };
    this.timeouts = Array(seatCount).fill(0);   // üst üste süre kaçırma sayısı
    this.auto = Array(seatCount).fill(false);   // otomatik oynananlar
    this.turnDeadline = 0;
    this.scores = Array(seatCount).fill(0);
    this.dealer = seatCount - 1;
    this.handNo = 0;
    this.over = false;
    this.handActive = false;
    this.lastResult = null;
    this.lastAccuse = Array(seatCount).fill(0);
    this.setSeq = 0;
  }

  // ---------- El akışı ----------
  startHand() {
    if (this.handNo >= this.opts.hands) {
      this.over = true;
      return ok([{ to: 'all', name: 'gameOver', data: { scores: this.scores } }]);
    }
    this.handNo++;
    this.dealer = (this.dealer + 1) % this.n;
    const tiles = shuffle(createTiles());
    const i = tiles.findIndex((t) => !t.fake);
    this.indicator = tiles.splice(i, 1)[0];
    this.okey = { c: this.indicator.c, n: nextValue(this.indicator.n) }; // el boyunca sabit
    this.hands = Array.from({ length: this.n }, () => []);
    const starter = (this.dealer + 1) % this.n;
    for (let s = 0; s < this.n; s++) {
      const cnt = CONFIG.HAND_SIZE + (s === starter ? 1 : 0);
      for (let k = 0; k < cnt; k++) this.hands[s].push(tiles.pop());
    }
    this.deck = tiles;
    this.discards = Array.from({ length: this.n }, () => []);
    this.table = [];                                  // { id, owner, type, tiles }
    this.openType = Array(this.n).fill(null);         // null | 'seri' | 'cift'
    this.openedTurn = Array(this.n).fill(-1);
    this.cifteGoer = Array(this.n).fill(false);      // "Çifte gidiyorum" diyenler
    this.openValue = Array(this.n).fill(0);           // seri açış toplamı
    this.openPairs = Array(this.n).fill(0);           // çift açış sayısı
    this.turnNo = 0;
    this.turn = starter;
    this.phase = 'discard';
    this.pendingTake = null;                          // yandan alınıp kullanılması zorunlu taş
    this.steals = [];
    this.stealCount = Array(this.n).fill(0);
    this.extra = Array(this.n).fill(0);               // desteden çalınıp henüz yana atılmamış taş sayısı
    this.caughtThisHand = Array(this.n).fill(0);      // bu elde kaç kez yakalandı (ceza katlanır)
    this.fakeCaught = Array(this.n).fill(0);          // bu elde kaç kez sahte okeyle yakalandı
    this.refundUsed = Array(this.n).fill(false);
    this.handActive = true;
    this.lastResult = null;
    this.beginTurn();
    return ok([{ to: 'all', name: 'handStarted', data: { handNo: this.handNo } }]);
  }

  // ---------- Süre ----------
  beginTurn() {
    this.turnDeadline = this.opts.turnTime ? Date.now() + this.opts.turnTime * 1000 : 0;
  }

  // Oyuncu kendisi bir hamle yaptı: otomatik oynama biter
  markActive(seat) {
    if (seat < 0 || seat >= this.n) return;
    this.timeouts[seat] = 0;
    this.auto[seat] = false;
  }

  // Süre doldu
  onTimeout(seat) {
    if (!this.handActive || this.turn !== seat) return fail('Sıra değişti');
    this.timeouts[seat]++;
    if (this.timeouts[seat] >= CONFIG.AFK_AFTER_TIMEOUTS) this.auto[seat] = true;
    const r = this.autoPlay(seat);
    if (r.ok) r.events.unshift({ to: 'all', name: 'timeout', data: { seat, auto: this.auto[seat] } });
    return r;
  }

  // Sırayı oyuncunun yerine oynar: gerekirse çeker, sonra en zararsız taşı atar
  autoPlay(seat) {
    if (!this.handActive || this.turn !== seat) return fail('Sıra değişti');
    const events = [];
    if (this.phase === 'discard' && this.pendingTake) {
      const u = this.untake(seat);
      if (u.ok) events.push(...u.events);
    }
    let drawnId = null;
    if (this.phase === 'draw') {
      if (!this.deck.length) return fail('Deste bitti');
      const d = this.draw(seat);
      if (!d.ok) return d;
      drawnId = this.hands[seat][this.hands[seat].length - 1].id;
    }
    const hand = this.hands[seat];
    const safe = (t) => !this.isJoker(t) && !this.table.some((s) => this.attachResult(t, s));
    let pick = hand.find((t) => t.id === drawnId && safe(t));
    if (!pick) {
      const cands = hand.filter(safe).sort((a, b) => b.n - a.n);
      pick = cands[0] || hand[hand.length - 1];
    }
    const r = this.discard(seat, pick.id);
    if (r.ok) r.events.unshift(...events, { to: 'all', name: 'autoPlayed', data: { seat } });
    return r;
  }

  teamOf(s) { return this.opts.esli ? s % 2 : s; }
  isRival(a, b) { return a !== b && this.teamOf(a) !== this.teamOf(b); }

  // Açmak için gereken sınır (katlamalıda rakiplerin açışının bir fazlası, eşinki sayılmaz)
  requiredFor(seat) {
    let seri = CONFIG.OPEN_MIN, pairs = CONFIG.OPEN_MIN_PAIRS;
    if (this.opts.katlamali && this.openType) {
      for (let o = 0; o < this.n; o++) {
        if (!this.isRival(seat, o)) continue;
        if (this.openType[o] === 'seri') seri = Math.max(seri, this.openValue[o] + 1);
        if (this.openType[o] === 'cift') pairs = Math.max(pairs, this.openPairs[o] + 1);
      }
    }
    return { seri, pairs };
  }

  isJoker(t) {
    return !t.fake && t.c === this.okey.c && t.n === this.okey.n;
  }

  tileValue(t) {
    return t.fake || this.isJoker(t) ? this.okey.n : t.n;
  }

  checkTurn(seat, phase) {
    if (!this.handActive) return fail('El aktif değil');
    if (this.turn !== seat) return fail('Sıra sende değil');
    if (phase && this.phase !== phase)
      return fail(phase === 'draw' ? 'Önce taş çekmelisin' : 'Önce taş atmalısın');
    return null;
  }

  draw(seat) {
    const e = this.checkTurn(seat, 'draw'); if (e) return e;
    if (!this.deck.length) return fail('Deste bitti');
    this.hands[seat].push(this.deck.pop());
    this.phase = 'discard';
    return ok();
  }

  // Yandan alma kuralları:
  // - Çifte giden (henüz açmamış) her taşı serbestçe alır, açma zorunluluğu yok.
  // - Açmamış oyuncu taşı alabilir; o taşla aynı turda açmalı ya da "Geri bırak" ile yerine koymalı.
  // - Çifte gidenin attığı taş sadece çift için kullanılabilir (seri için kullanılamaz).
  // - Açmış oyuncu serbestçe alır. Çifte gidenin taşını alırsa çiftini masaya koymalı ya da geri bırakmalı.
  take(seat) {
    const e = this.checkTurn(seat, 'draw'); if (e) return e;
    const pileSeat = (seat - 1 + this.n) % this.n;
    const pile = this.discards[pileSeat];
    if (!pile.length) return fail('Alınacak taş yok');
    const tile = pile[pile.length - 1];
    const fromCifte = this.cifteGoer[pileSeat];
    const opened = this.openType[seat];
    let pending = null;

    if (this.cifteGoer[seat] && !opened) pending = null;                 // serbest
    else if (opened) pending = fromCifte ? { tileId: tile.id, mode: 'pairLay' } : null;
    else pending = { tileId: tile.id, mode: fromCifte ? 'cift' : 'any' };

    if (pending) pending.pileSeat = pileSeat;
    this.hands[seat].push(pile.pop());
    this.phase = 'discard';
    this.pendingTake = pending;
    return ok();
  }

  // Açamayacağını görünce yandan aldığı taşı yerine bırakır, desteden çekmeye döner
  untake(seat) {
    const e = this.checkTurn(seat, 'discard'); if (e) return e;
    if (!this.pendingTake) return fail('Geri bırakılacak taş yok');
    const hand = this.hands[seat];
    const i = hand.findIndex((t) => t.id === this.pendingTake.tileId);
    if (i < 0) { this.pendingTake = null; return fail('Taş artık elinde değil'); }
    this.discards[this.pendingTake.pileSeat].push(hand.splice(i, 1)[0]);
    this.pendingTake = null;
    this.phase = 'draw';
    return ok([{ to: 'all', name: 'untake', data: { seat } }]);
  }

  // Tek tıkla "Çifte gidiyorum" (geri dönüşü yok)
  declareCifte(seat) {
    const e = this.checkTurn(seat); if (e) return e;
    if (this.openType[seat]) return fail('Açtıktan sonra çifte gidilmez');
    if (this.cifteGoer[seat]) return fail('Zaten çifte gidiyorsun');
    this.cifteGoer[seat] = true;
    return ok([{ to: 'all', name: 'cifteDeclared', data: { seat } }]);
  }

  // ---------- Açma ve işleme ----------
  // sets: [[tileId, ...], ...]  (seri için sıra önemli)
  // down: ters çevrilerek konan taşların id'leri (okey gibi sayılır)
  faceDown(seat, t, downSet) {
    if (!downSet.has(t.id)) return { ...t };
    if (!this.opts.steal && !this.isJoker(t)) return null; // dürüst masada sadece okey ters konur
    return { ...t, down: true };
  }

  checkSets(seat, sets, down = []) {
    if (!Array.isArray(sets) || !sets.length) return fail('Per yok');
    const hand = this.hands[seat];
    const downSet = new Set(Array.isArray(down) ? down : []);
    const used = new Set();
    const result = [];
    for (const ids of sets) {
      if (!Array.isArray(ids)) return fail('Geçersiz per');
      const tiles = [];
      for (const id of ids) {
        const t = hand.find((x) => x.id === id);
        if (!t || used.has(id)) return fail('Taş elinde değil');
        used.add(id);
        const copy = this.faceDown(seat, t, downSet);
        if (!copy) return fail('Dürüst masada sadece okey ters çevrilebilir');
        tiles.push(copy);
      }
      const v = validateSet(tiles, this.okey);
      if (!v) return fail('Geçersiz per var');
      result.push({ ...v, tiles });
    }
    const pairs = result.filter((r) => r.type === 'pair').length;
    if (pairs && pairs !== result.length) return fail('Çift ile seri aynı anda açılmaz');
    const total = result.reduce((a, r) => a + r.value, 0);
    return { ok: true, result, used, total, kind: pairs ? 'cift' : 'seri' };
  }

  open(seat, sets, down) {
    const e = this.checkTurn(seat, 'discard'); if (e) return e;
    const c = this.checkSets(seat, sets, down);
    if (!c.ok) return c;
    const current = this.openType[seat];

    // Açmış oyuncu çifte gidenden aldığı taşla çiftini masaya koyar
    if (this.pendingTake && this.pendingTake.mode === 'pairLay') {
      if (c.result.length !== 1 || c.kind !== 'cift' || !c.used.has(this.pendingTake.tileId))
        return fail('Aldığın taşla sadece o çifti koymalısın');
      if (this.hands[seat].length - 2 < 1) return fail('Atmak için elinde bir taş kalmalı');
      this.hands[seat] = this.hands[seat].filter((t) => !c.used.has(t.id));
      this.table.push({ id: ++this.setSeq, owner: seat, type: 'pair', tiles: c.result[0].tiles });
      this.pendingTake = null;
      return ok([{ to: 'all', name: 'opened', data: { seat, kind: 'cift', total: 0, first: false } }]);
    }

    if (this.cifteGoer[seat] && c.kind !== 'cift') return fail('Çifte gidiyorsun, sadece çift açabilirsin');
    if (this.pendingTake && this.pendingTake.mode === 'cift' && c.kind !== 'cift')
      return fail('Bu taşı çift için aldın, çift açmalısın');
    if (current && current !== c.kind)
      return fail(current === 'cift' ? 'Çift açtın, sadece çift koyabilirsin' : 'Seri açtın, çift koyamazsın');
    if (!current) {
      const req = this.requiredFor(seat);
      if (c.kind === 'seri' && c.total < req.seri)
        return fail(`Açmak için ${req.seri} lazım, sende ${c.total}`);
      if (c.kind === 'cift' && c.result.length < req.pairs)
        return fail(`Çift açmak için en az ${req.pairs} çift lazım`);
    }
    if (this.pendingTake && !c.used.has(this.pendingTake.tileId))
      return fail('Yandan aldığın taşı açtığın perlerde kullanmalısın');
    if (this.hands[seat].length - c.used.size < 1) return fail('Atmak için elinde bir taş kalmalı');

    this.hands[seat] = this.hands[seat].filter((t) => !c.used.has(t.id));
    for (const r of c.result)
      this.table.push({ id: ++this.setSeq, owner: seat, type: r.type, tiles: r.tiles });
    let bonus = 0;
    if (!current) {
      this.openType[seat] = c.kind;
      this.openedTurn[seat] = this.turnNo;
      const pairCount = c.result.length;
      if (c.kind === 'seri') this.openValue[seat] = c.total; else this.openPairs[seat] = pairCount;
      // Açış bonusu: seri 150+ tek siler, 180+ çift siler; çift 7+ tek siler, 9+ çift siler
      const silers = c.kind === 'seri'
        ? (c.total >= CONFIG.SERI_DOUBLE_SILER ? 2 : c.total >= CONFIG.SERI_SILER ? 1 : 0)
        : (pairCount >= CONFIG.CIFT_DOUBLE_SILER ? 2 : pairCount >= CONFIG.CIFT_SILER ? 1 : 0);
      bonus = silers * CONFIG.WIN_BONUS;
      this.scores[seat] -= bonus;
    }
    this.pendingTake = null;
    return ok([{ to: 'all', name: 'opened', data: { seat, kind: c.kind, total: c.total, pairs: c.result.length, first: !current, bonus } }]);
  }

  // Taş masadaki pere eklenebilir mi? Eklenebiliyorsa yeni dizilim döner.
  attachResult(tile, set) {
    if (set.type === 'pair') return null;
    for (const tiles of [[tile, ...set.tiles], [...set.tiles, tile]]) {
      const v = validateSet(tiles, this.okey);
      if (v && v.type === set.type) return tiles;
    }
    return null;
  }

  attach(seat, tileId, setId, down) {
    const e = this.checkTurn(seat, 'discard'); if (e) return e;
    if (this.openType[seat] !== 'seri') return fail('İşlemek için önce seri açmalısın');
    const hand = this.hands[seat];
    const i = hand.findIndex((t) => t.id === tileId);
    if (i < 0) return fail('Taş elinde değil');
    if (hand.length < 2) return fail('Atmak için elinde bir taş kalmalı');
    const set = this.table.find((s) => s.id === setId);
    if (!set) return fail('Per bulunamadı');
    const copy = this.faceDown(seat, hand[i], new Set(down ? [tileId] : []));
    if (!copy) return fail('Dürüst masada sadece okey ters çevrilebilir');
    const tiles = this.attachResult(copy, set);
    if (!tiles) return fail('Bu taş bu pere gitmez');
    set.tiles = tiles;
    hand.splice(i, 1);
    return ok();
  }

  // Masadaki okeyin yerine gerçek taşı koyup okeyi almak
  swapJoker(seat, tileId, setId) {
    const e = this.checkTurn(seat, 'discard'); if (e) return e;
    if (this.openType[seat] !== 'seri') return fail('Okey almak için önce seri açmalısın');
    const hand = this.hands[seat];
    const i = hand.findIndex((t) => t.id === tileId);
    if (i < 0) return fail('Taş elinde değil');
    const set = this.table.find((s) => s.id === setId);
    if (!set || set.type === 'pair') return fail('Per bulunamadı');
    for (let k = 0; k < set.tiles.length; k++) {
      const st = set.tiles[k];
      if (!st.down && !this.isJoker(st)) continue;
      const tiles = [...set.tiles];
      tiles[k] = { ...hand[i] };
      const v = validateSet(tiles, this.okey);
      if (v && v.type === set.type) {
        // Ters taş aslında okey değilse: almaya çalışan sahteyi ortaya çıkarır
        if (st.down && !this.isJoker(st) && set.owner !== seat) return this.challengeDown(seat, setId, st.id, true);
        set.tiles = tiles;
        hand[i] = this.cleanTile(st);
        return ok();
      }
    }
    return fail('Bu taş buradaki okeyin yerine geçmez');
  }

  cleanTile(t) {
    const c = { id: t.id, c: t.c, n: t.n };
    if (t.fake) c.fake = true;
    return c;
  }

  // Masadaki ters taşa itiraz: "Bu okey değil!"
  challengeDown(seat, setId, tileId, viaSwap = false) {
    if (!this.handActive) return fail('El aktif değil');
    const set = this.table.find((s) => s.id === setId);
    if (!set) return fail('Per bulunamadı');
    const k = set.tiles.findIndex((t) => t.id === tileId);
    if (k < 0 || !set.tiles[k].down) return fail('Bu taş ters değil');
    if (set.owner === seat) return fail('Kendi taşına itiraz edemezsin');
    const now = Date.now();
    if (!viaSwap) {
      if (now - this.lastAccuse[seat] < CONFIG.ACCUSE_COOLDOWN_MS) return fail('Biraz bekle');
      this.lastAccuse[seat] = now;
    }
    const tile = set.tiles[k];
    const owner = set.owner;

    if (this.isJoker(tile)) {
      // Gerçekten okey: ters taş açılır, itiraz eden ceza yer
      set.tiles[k] = { ...tile, down: false, shown: true };
      this.scores[seat] += CONFIG.FALSE_ACCUSE_PENALTY;
      return ok([{ to: 'all', name: 'fakeMiss', data: { by: seat, owner, penalty: CONFIG.FALSE_ACCUSE_PENALTY } }]);
    }

    // Sahte okey: sahibi ceza yer (202, 404...), taş eline geri döner
    const penalty = CONFIG.FAKE_OKEY_PENALTY * 2 ** this.fakeCaught[owner];
    this.fakeCaught[owner]++;
    this.scores[owner] += penalty;
    this.scores[seat] -= CONFIG.CATCH_REWARD;
    set.tiles.splice(k, 1);
    this.hands[owner].push(this.cleanTile(tile));
    let broken = false;
    if (!validateSet(set.tiles, this.okey)) {
      // per bozulduysa bütün taşlar sahibine döner
      for (const t of set.tiles) this.hands[owner].push(this.cleanTile(t));
      this.table = this.table.filter((s) => s !== set);
      broken = true;
    }
    return ok([{ to: 'all', name: 'fakeCaught', data: { by: seat, owner, tile: this.cleanTile(tile), penalty, times: this.fakeCaught[owner], broken } }]);
  }

  // ---------- Atma ve bitirme ----------
  discard(seat, tileId) {
    const e = this.checkTurn(seat, 'discard'); if (e) return e;
    const hand = this.hands[seat];
    // aldığı taşı çalma ile elden çıkardıysa zorunluluk kalkar
    if (this.pendingTake && !hand.some((t) => t.id === this.pendingTake.tileId)) this.pendingTake = null;
    if (this.pendingTake) return fail(this.pendingTake.mode === 'pairLay' ? 'Aldığın taşla çiftini koy ya da geri bırak' : 'Yandan aldığın taşla aç ya da geri bırak');
    const i = hand.findIndex((t) => t.id === tileId);
    if (i < 0) return fail('Taş elinde değil');
    const tile = hand[i];
    const finishing = hand.length === 1;
    const events = [];

    if (!finishing) {
      const islek = this.isJoker(tile) || this.table.some((s) => this.attachResult(tile, s));
      if (islek) {
        this.scores[seat] += CONFIG.ISLEK_PENALTY;
        events.push({ to: 'all', name: 'islek', data: { seat, joker: this.isJoker(tile) } });
      }
    }

    hand.splice(i, 1);
    this.discards[seat].push(tile);

    if (finishing) {
      const r = this.endHand(seat, this.isJoker(tile));
      r.events.unshift(...events);
      return r;
    }
    this.turn = (seat + 1) % this.n;
    this.turnNo++;
    this.phase = 'draw';
    this.beginTurn();
    if (!this.deck.length) {
      const r = this.endHand(null, false);
      r.events.unshift(...events);
      return r;
    }
    return ok(events);
  }

  // Puanlama:
  // - Biten -101 (tek siler) yazar, rakipler kalanlarını yazar (açamayan 202).
  // - Kimse açmadan biterse x2, çift ile biterse x2 (ikisi birden x4), okey atarak biterse ayrıca x2.
  // - Eşli oyunda katlar sadece rakiplere uygulanır; bitenin eşi kalanını tek yazar.
  endHand(winner, okeyFinish) {
    this.handActive = false;
    this.turnDeadline = 0;
    const penalties = Array(this.n).fill(0);
    let mult = 1, elden = false, cifte = false;
    if (winner !== null) {
      elden = this.openType.every((t, s) => s === winner || !t);
      cifte = this.openType[winner] === 'cift';
      if (elden) mult *= 2;
      if (cifte) mult *= 2;
      if (okeyFinish) mult *= 2;
      for (let s = 0; s < this.n; s++) {
        if (s === winner) { penalties[s] = -CONFIG.WIN_BONUS * mult; continue; }
        const m = this.isRival(winner, s) ? mult : 1;
        if (!this.openType[s]) { penalties[s] = CONFIG.NOT_OPENED_PENALTY * m; continue; }
        const sum = this.hands[s].reduce((a, t) => a + this.tileValue(t), 0);
        penalties[s] = sum * m;
      }
    }
    for (let s = 0; s < this.n; s++) this.scores[s] += penalties[s];
    this.lastResult = { winner, okeyFinish, elden, cifte, mult, penalties, handNo: this.handNo };
    return ok([{ to: 'all', name: 'handEnded', data: this.lastResult }]);
  }

  // Ödüllü reklam karşılığı: son elin cezasının yarısı silinir.
  // TODO (mobil): AdMob sunucu tarafı doğrulama (SSV) gelmeden bunu verme.
  refund(seat) {
    if (this.handActive || !this.lastResult || this.over) return fail('Şu an kullanılamaz');
    if (this.refundUsed[seat]) return fail('Bu el için zaten kullandın');
    const p = this.lastResult.penalties[seat];
    if (!(p > 0)) return fail('Silinecek ceza yok');
    const back = Math.ceil(p * CONFIG.REWARD_REFUND_RATIO);
    this.scores[seat] -= back;
    this.refundUsed[seat] = true;
    return ok([{ to: 'all', name: 'refunded', data: { seat, back } }]);
  }

  // ---------- Çalma ----------
  // kind: 'deck'    -> desteden gizlice FAZLADAN bir taş çeker (taş sayısı bir fazla görünür).
  //                    Çekme sırasında yapılırsa ortadan 2 taş alır: biri normal çekiş sayılır.
  //                    Fazla taşı fark ettirmeden dump() ile yanına (çöpüne) atmalıdır.
  //                    Elinde fazla taş durduğu sürece, attıktan sonra da CATCH_WINDOW_MS boyunca yakalanabilir.
  // kind: 'discard' -> elindeki bir taşı çöpteki herhangi bir taşla değiştirir (CATCH_WINDOW_MS boyunca yakalanabilir).
  steal(seat, { kind, handTileId, pileSeat, pileTileId }) {
    if (!this.opts.steal) return fail('Bu masada taş çalma kapalı');
    if (this.checkTurn(seat)) return fail('Sadece kendi sırandayken çalabilirsin');
    if (this.stealCount[seat] >= CONFIG.STEAL_LIMIT) return fail('Bu elde çalma hakkın bitti');
    const hand = this.hands[seat];
    const now = Date.now();
    const events = [];

    if (kind === 'deck') {
      // Çekme sırasındaysa: biri normal çekiş, biri çalıntı (ortadan 2 taş). Sonra direkt taş atar.
      const asDraw = this.phase === 'draw';
      if (this.deck.length < (asDraw ? 2 : 1)) return fail('Destede yeterli taş yok');
      if (asDraw) { hand.push(this.deck.pop()); this.phase = 'discard'; }
      const got = this.deck.pop();
      hand.push(got);
      this.extra[seat]++;
      this.steals.push({ thief: seat, kind, gotId: got.id, time: now, caught: false, dumpedId: null, dumpTime: 0 });
      if (Math.random() < CONFIG.DECK_HINT_CHANCE)
        events.push({ to: 'others', except: seat, name: 'hint', data: { seat, kind } });
    } else if (kind === 'discard') {
      const hi = hand.findIndex((t) => t.id === handTileId);
      if (hi < 0) return fail('Önce elinden vereceğin taşı seç');
      const pile = this.discards[pileSeat];
      if (!pile) return fail('Geçersiz çöp');
      const pi = pile.findIndex((t) => t.id === pileTileId);
      if (pi < 0) return fail('Çöpten bir taş seç');
      const given = hand[hi], got = pile[pi];
      pile[pi] = given;
      hand[hi] = got;
      this.steals.push({ thief: seat, kind, givenId: given.id, gotId: got.id, pileSeat, time: now, caught: false });
    } else return fail('Geçersiz çalma');

    this.stealCount[seat]++;
    return ok(events);
  }

  // Desteden çalınan fazlalığı gizlice yanına (kendi çöpüne) atar. Sıra beklemez.
  dump(seat, tileId) {
    if (!this.opts.steal) return fail('Bu masada taş çalma kapalı');
    if (!this.handActive) return fail('El aktif değil');
    if (!this.extra[seat]) return fail('Elinde fazla taş yok');
    const hand = this.hands[seat];
    const i = hand.findIndex((t) => t.id === tileId);
    if (i < 0) return fail('Önce yana atacağın taşı seç');
    if (this.pendingTake && this.turn === seat && this.pendingTake.tileId === tileId) return fail('Yandan aldığın taşı yana atamazsın');
    this.discards[seat].push(hand.splice(i, 1)[0]);
    this.extra[seat]--;
    const st = [...this.steals].reverse().find((s) => s.thief === seat && s.kind === 'deck' && !s.caught && !s.dumpedId);
    if (st) { st.dumpedId = tileId; st.dumpTime = Date.now(); }
    return ok();
  }

  accuse(seat, target) {
    if (!this.opts.steal) return fail('Bu masada taş çalma kapalı');
    if (!this.handActive) return fail('El aktif değil');
    if (target === seat || !(target >= 0 && target < this.n)) return fail('Geçersiz oyuncu');
    const now = Date.now();
    if (now - this.lastAccuse[seat] < CONFIG.ACCUSE_COOLDOWN_MS) return fail('Biraz bekle');
    this.lastAccuse[seat] = now;

    const W = CONFIG.CATCH_WINDOW_MS;
    const st = [...this.steals].reverse().find((s) => {
      if (s.thief !== target || s.caught) return false;
      if (s.kind === 'deck') return !s.dumpedId || now - s.dumpTime <= W; // elinde tutuyor ya da yeni attı
      return now - s.time <= W;
    });
    if (st) {
      st.caught = true;
      // Ceza her yakalanışta 2 katına çıkar (her elde sıfırlanır): 101, 202, 404...
      const penalty = CONFIG.CAUGHT_PENALTY * 2 ** this.caughtThisHand[target];
      this.caughtThisHand[target]++;
      this.scores[target] += penalty;
      this.scores[seat] -= CONFIG.CATCH_REWARD;
      const reverted = this.revert(st);
      return ok([{ to: 'all', name: 'caught', data: { thief: target, by: seat, kind: st.kind, reverted, penalty, times: this.caughtThisHand[target] } }]);
    }
    this.scores[seat] += CONFIG.FALSE_ACCUSE_PENALTY;
    return ok([{ to: 'all', name: 'falseAccuse', data: { by: seat, target } }]);
  }

  revert(st) {
    const hand = this.hands[st.thief];
    if (st.kind === 'deck') {
      if (!st.dumpedId) {
        // fazla taş hâlâ elinde: desteye geri koy
        let i = hand.findIndex((t) => t.id === st.gotId);
        if (i < 0) i = hand.length - 1;
        if (i < 0 || hand.length <= 1) return false;
        this.deck.push(hand.splice(i, 1)[0]);
        this.extra[st.thief] = Math.max(0, this.extra[st.thief] - 1);
        return true;
      }
      const pile = this.discards[st.thief];
      const pi = pile.findIndex((t) => t.id === st.dumpedId);
      if (pi < 0) return false;
      this.deck.push(pile.splice(pi, 1)[0]);
      return true;
    }
    const hi = hand.findIndex((t) => t.id === st.gotId);
    if (hi < 0) return false;
    const pile = this.discards[st.pileSeat];
    const pi = pile.findIndex((t) => t.id === st.givenId);
    if (pi < 0) return false;
    const got = hand[hi];
    hand[hi] = pile[pi]; pile[pi] = got;
    return true;
  }

  viewFor(seat) {
    return {
      seat,
      n: this.n,
      handNo: this.handNo,
      totalHands: this.opts.hands,
      handActive: this.handActive,
      over: this.over,
      myHand: this.hands ? this.hands[seat] : [],
      handCounts: this.hands ? this.hands.map((h) => h.length) : [],
      discards: this.discards || [],
      table: (this.table || []).map((s) => ({
        ...s,
        tiles: s.tiles.map((t) => (t.down && s.owner !== seat ? { id: t.id, down: true } : t)),
      })),
      openType: this.openType || [],
      cifteGoer: this.cifteGoer || [],
      indicator: this.indicator || null,
      okey: this.okey || null,
      deckCount: this.deck ? this.deck.length : 0,
      turn: this.turn,
      phase: this.phase,
      pendingTake: this.turn === seat ? this.pendingTake : null,
      scores: this.scores,
      stealsLeft: this.stealCount ? CONFIG.STEAL_LIMIT - this.stealCount[seat] : 0,
      myExtra: this.extra ? this.extra[seat] : 0,
      lastResult: this.lastResult,
      refundUsed: this.refundUsed ? this.refundUsed[seat] : false,
      openMin: this.openType ? this.requiredFor(seat).seri : CONFIG.OPEN_MIN,
      openMinPairs: this.openType ? this.requiredFor(seat).pairs : CONFIG.OPEN_MIN_PAIRS,
      openValue: this.openValue || [],
      openPairs: this.openPairs || [],
      opts: this.opts,
      turnDeadline: this.turnDeadline,
      auto: this.auto,
      serverNow: Date.now(),
    };
  }
}

module.exports = { Okey101, CONFIG, validateSet, canOpenSeriWith, canOpenCiftWith };
