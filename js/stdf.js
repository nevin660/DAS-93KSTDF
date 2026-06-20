/* Browser-side STDF V4 parser (little-endian / CPU_TYPE=2 verified at runtime).
   Port of parse_stdf.py. Returns a raw data object consumed by buildPayload(). */
(function (global) {
  "use strict";

  class Reader {
    constructor(dv, start, end) { this.dv = dv; this.p = start; this.end = end; }
    rem() { return this.end - this.p; }
    u1() { if (this.rem() < 1) return null; return this.dv.getUint8(this.p++); }
    u2() { if (this.rem() < 2) return null; const v = this.dv.getUint16(this.p, true); this.p += 2; return v; }
    u4() { if (this.rem() < 4) return null; const v = this.dv.getUint32(this.p, true); this.p += 4; return v; }
    i1() { if (this.rem() < 1) return null; return this.dv.getInt8(this.p++); }
    i2() { if (this.rem() < 2) return null; const v = this.dv.getInt16(this.p, true); this.p += 2; return v; }
    i4() { if (this.rem() < 4) return null; const v = this.dv.getInt32(this.p, true); this.p += 4; return v; }
    r4() { if (this.rem() < 4) return null; const v = this.dv.getFloat32(this.p, true); this.p += 4; return v; }
    r8() { if (this.rem() < 8) return null; const v = this.dv.getFloat64(this.p, true); this.p += 8; return v; }
    b1() { return this.u1(); }
    c1() { if (this.rem() < 1) return null; return String.fromCharCode(this.dv.getUint8(this.p++)); }
    cn() {
      if (this.rem() < 1) return null;
      let ln = this.dv.getUint8(this.p++);
      if (ln === 0) return "";
      if (this.rem() < ln) ln = this.rem();
      let s = "";
      for (let i = 0; i < ln; i++) s += String.fromCharCode(this.dv.getUint8(this.p + i));
      this.p += ln; return s;
    }
    nibbles(count) {
      const nbytes = (count + 1) >> 1, out = [];
      for (let i = 0; i < count; i++) {
        const off = this.p + (i >> 1);
        const byte = off < this.end ? this.dv.getUint8(off) : 0;
        out.push(i % 2 === 0 ? (byte & 0xF) : ((byte >> 4) & 0xF));
      }
      this.p += nbytes; return out;
    }
  }

  const MIR_STR = ["LOT_ID", "PART_TYP", "NODE_NAM", "TSTR_TYP", "JOB_NAM", "JOB_REV",
    "SBLOT_ID", "OPER_NAM", "EXEC_TYP", "EXEC_VER", "TEST_COD", "TST_TEMP",
    "USER_TXT", "AUX_FILE", "PKG_TYP", "FAMLY_ID", "DATE_COD", "FACIL_ID",
    "FLOOR_ID", "PROC_ID", "OPER_FRQ", "SPEC_NAM", "SPEC_VER", "FLOW_ID",
    "SETUP_ID", "DSGN_REV", "ENG_ID", "ROM_COD", "SERL_NUM", "SUPR_NAM"];
  const SDR_STR = ["HAND_TYP", "HAND_ID", "CARD_TYP", "CARD_ID", "LOAD_TYP", "LOAD_ID",
    "DIB_TYP", "DIB_ID", "CABL_TYP", "CABL_ID", "CONT_TYP", "CONT_ID",
    "LASR_TYP", "LASR_ID", "EXTR_TYP", "EXTR_ID"];

  function parseSTDF(buffer, fileName, onProgress) {
    const dv = new DataView(buffer);
    const N = buffer.byteLength;
    let pos = 0;

    const mir = {}, wir = {}, wrr = {}, sdr = {}, mrr = {};
    const vur = [], atr = [];
    const hbins = new Map(), sbins = new Map();
    const tsr = [], pcr = [];
    const testInfo = new Map();      // num -> {num,name,units,lo,hi,type}
    const openParts = new Map();     // "h,s" -> part
    const parts = [];

    let lastReport = 0;
    while (pos + 4 <= N) {
      const rl = dv.getUint16(pos, true);
      const typ = dv.getUint8(pos + 2), sub = dv.getUint8(pos + 3);
      const bodyStart = pos + 4, bodyEnd = Math.min(pos + 4 + rl, N);
      pos = pos + 4 + rl;
      const k = typ * 256 + sub;

      if (onProgress && pos - lastReport > 4_000_000) {
        lastReport = pos; onProgress(pos / N);
      }

      if (k === 0 * 256 + 10) {                 // FAR
        // cpu/ver — ignore
      } else if (k === 0 * 256 + 20) {          // ATR
        const r = new Reader(dv, bodyStart, bodyEnd); r.u4(); atr.push(r.cn());
      } else if (k === 0 * 256 + 30) {          // VUR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const cnt = r.u1() || 0;
        if (cnt) { for (let i = 0; i < cnt; i++) vur.push(r.cn()); }
        else vur.push(r.cn());
      } else if (k === 1 * 256 + 10) {          // MIR
        const r = new Reader(dv, bodyStart, bodyEnd);
        mir.SETUP_T = r.u4(); mir.START_T = r.u4(); mir.STAT_NUM = r.u1();
        mir.MODE_COD = r.c1(); mir.RTST_COD = r.c1(); mir.PROT_COD = r.c1();
        mir.BURN_TIM = r.u2(); mir.CMOD_COD = r.c1();
        for (const f of MIR_STR) mir[f] = r.cn();
      } else if (k === 1 * 256 + 20) {          // MRR
        const r = new Reader(dv, bodyStart, bodyEnd);
        mrr.FINISH_T = r.u4(); mrr.DISP_COD = r.c1();
        mrr.USR_DESC = r.cn(); mrr.EXC_DESC = r.cn();
      } else if (k === 1 * 256 + 30) {          // PCR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const hn = r.u1(), sn = r.u1();
        pcr.push({ head: hn, site: sn, part: r.u4(), rtst: r.u4(),
          abrt: r.u4(), good: r.u4(), func: r.u4() });
      } else if (k === 1 * 256 + 40 || k === 1 * 256 + 50) {  // HBR / SBR
        const r = new Reader(dv, bodyStart, bodyEnd);
        r.u1(); r.u1();
        const num = r.u2(), cnt = r.u4(), pf = r.c1(), nam = r.cn();
        const map = (k === 1 * 256 + 40) ? hbins : sbins;
        let d = map.get(num);
        if (!d) { d = { num, cnt: 0, pf, name: nam }; map.set(num, d); }
        d.cnt += cnt;
        if (pf && pf !== " ") d.pf = pf;
        if (nam) d.name = nam;
      } else if (k === 1 * 256 + 80) {          // SDR
        const r = new Reader(dv, bodyStart, bodyEnd);
        sdr.HEAD_NUM = r.u1(); sdr.SITE_GRP = r.u1();
        const scnt = r.u1() || 0; const sn = [];
        for (let i = 0; i < scnt; i++) sn.push(r.u1());
        sdr.SITE_NUM = sn;
        for (const f of SDR_STR) sdr[f] = r.cn();
      } else if (k === 2 * 256 + 10) {          // WIR
        const r = new Reader(dv, bodyStart, bodyEnd);
        wir.HEAD_NUM = r.u1(); wir.SITE_GRP = r.u1();
        wir.START_T = r.u4(); wir.WAFER_ID = r.cn();
      } else if (k === 2 * 256 + 20) {          // WRR
        const r = new Reader(dv, bodyStart, bodyEnd);
        wrr.HEAD_NUM = r.u1(); wrr.SITE_GRP = r.u1(); wrr.FINISH_T = r.u4();
        wrr.PART_CNT = r.u4(); wrr.RTST_CNT = r.u4(); wrr.ABRT_CNT = r.u4();
        wrr.GOOD_CNT = r.u4(); wrr.FUNC_CNT = r.u4(); wrr.WAFER_ID = r.cn();
      } else if (k === 5 * 256 + 10) {          // PIR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const hn = r.u1(), sn = r.u1();
        openParts.set(hn + "," + sn, { head: hn, site: sn, tests: {} });
      } else if (k === 5 * 256 + 20) {          // PRR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const hn = r.u1(), sn = r.u1(), pflg = r.b1(), ntest = r.u2();
        const hbin = r.u2(), sbin = r.u2(), xc = r.i2(), yc = r.i2();
        const tt = r.u4(), pid = r.cn();
        const key = hn + "," + sn;
        let p = openParts.get(key);
        if (p) openParts.delete(key); else p = { head: hn, site: sn, tests: {} };
        const failed = pflg != null ? !!(pflg & 0x08) : false;
        const pfInvalid = pflg != null ? !!(pflg & 0x10) : false;
        const passed = pfInvalid ? (hbin === 1) : !failed;
        p.part_id = pid; p.hbin = hbin; p.sbin = sbin; p.x = xc; p.y = yc;
        p.num_test = ntest; p.passed = passed; p.test_time_ms = tt;
        parts.push(p);
      } else if (k === 15 * 256 + 10) {         // PTR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const tn = r.u4(), hn = r.u1(), sn = r.u1();
        const tflg = r.b1(); r.b1(); const result = r.r4();
        const ttxt = r.cn(); r.cn(); const optf = r.b1();
        r.i1(); r.i1(); r.i1();
        const lo = r.r4(), hi = r.r4(), units = r.cn();
        let ti = testInfo.get(tn);
        if (!ti) { ti = { num: tn, name: ttxt || "", units: units || "", lo: null, hi: null, type: "P" }; testInfo.set(tn, ti); }
        if (!ti.name && ttxt) ti.name = ttxt;
        if (!ti.units && units) ti.units = units;
        if (optf != null) {
          if (ti.lo == null && lo != null && !(optf & 0x10)) ti.lo = lo;
          if (ti.hi == null && hi != null && !(optf & 0x20)) ti.hi = hi;
        }
        const p = openParts.get(hn + "," + sn);
        if (p && result != null) p.tests[tn] = result;
      } else if (k === 15 * 256 + 15) {         // MPR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const tn = r.u4(), hn = r.u1(), sn = r.u1();
        r.b1(); r.b1();
        const j = r.u2() || 0, kk = r.u2() || 0;
        if (j) r.nibbles(j);
        const rslts = [];
        for (let i = 0; i < kk; i++) rslts.push(r.r4());
        const ttxt = r.cn();
        let ti = testInfo.get(tn);
        if (!ti) { ti = { num: tn, name: ttxt || "", units: "", lo: null, hi: null, type: "M" }; testInfo.set(tn, ti); }
        const p = openParts.get(hn + "," + sn);
        if (p && rslts.length) p.tests[tn] = rslts[0];
      } else if (k === 10 * 256 + 30) {         // TSR
        const r = new Reader(dv, bodyStart, bodyEnd);
        const hn = r.u1(), sn = r.u1(), ttyp = r.c1(), tn = r.u4();
        const ex = r.u4(), fl = r.u4(); r.u4(); const nam = r.cn();
        tsr.push({ head: hn, site: sn, type: ttyp, num: tn, exec: ex, fail: fl, name: nam });
      }
      // other records ignored
    }

    return {
      mir, wir, wrr, sdr, mrr, vur, atr,
      hbins, sbins, pcr, tsr, test_info: testInfo, parts,
      file_name: fileName, file_size: N
    };
  }

  global.parseSTDF = parseSTDF;
})(window);
