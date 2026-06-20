/* Folder / archive importer for STDF files (browser, fully local).
   Supports: .stdf/.std, folders (webkitdirectory or drag), .gz, .zip, .tar, .tar.gz/.tgz.
   Returns a normalized list: [{ name, size, load: async () => ArrayBuffer }]. */
(function (global) {
  "use strict";

  const isStdfName = n => /\.(stdf|std)$/i.test(n);

  // ---- minimal tar parser (512-byte blocks; handles regular files + ustar/GNU long names) ----
  function untar(u) {
    const out = []; let off = 0; let longName = null;
    const str = (o, l) => { let s = ""; for (let i = 0; i < l; i++) { const c = u[o + i]; if (c === 0) break; s += String.fromCharCode(c); } return s; };
    while (off + 512 <= u.length) {
      let zero = true; for (let i = 0; i < 512; i++) if (u[off + i] !== 0) { zero = false; break; }
      if (zero) break;
      let name = str(off, 100);
      const prefix = str(off + 345, 155);
      if (prefix) name = prefix + "/" + name;
      const size = parseInt(str(off + 124, 12).trim(), 8) || 0;
      const type = String.fromCharCode(u[off + 156] || 0);
      const dataOff = off + 512;
      if (type === "L") { // GNU long name
        longName = str(dataOff, size).replace(/\0+$/, "");
      } else {
        if (longName) { name = longName; longName = null; }
        if (type === "" || type === "0" || u[off + 156] === 0)
          out.push({ name, data: u.subarray(dataOff, dataOff + size) });
      }
      off = dataOff + Math.ceil(size / 512) * 512;
    }
    return out;
  }

  function gunzip(u) { return global.fflate.gunzipSync(u); }
  function unzip(u) { return global.fflate.unzipSync(u); }
  const toBuf = a => a.slice().buffer; // copy view -> own ArrayBuffer (DataView-safe)

  // extract STDF entries from an archive's bytes; pushes {name, size, load} into out
  function extractArchive(name, u, out) {
    const lower = name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const z = unzip(u);
      for (const path in z) {
        const base = path.split("/").pop();
        if (isStdfName(base)) out.push(staticEntry(base, z[path]));
        else if (/\.gz$/i.test(base) && isStdfName(base.replace(/\.gz$/i, "")))
          out.push(staticEntry(base.replace(/\.gz$/i, ""), gunzip(z[path])));
      }
    } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      untar(gunzip(u)).forEach(e => { const b = e.name.split("/").pop(); if (isStdfName(b)) out.push(staticEntry(b, e.data)); });
    } else if (lower.endsWith(".tar")) {
      untar(u).forEach(e => { const b = e.name.split("/").pop(); if (isStdfName(b)) out.push(staticEntry(b, e.data)); });
    }
  }
  function staticEntry(name, arr) {
    const buf = toBuf(arr);
    return { name, size: buf.byteLength, load: () => Promise.resolve(buf) };
  }

  const isArchive = n => /\.(zip|tar|tgz|tar\.gz)$/i.test(n);
  const isCandidate = n => isStdfName(n) || isArchive(n) || /\.gz$/i.test(n);

  async function collect(files) {
    const out = [];
    for (const f of files) {
      const nm = f.name, lower = nm.toLowerCase();
      if (!isCandidate(nm)) continue;
      try {
        if (isArchive(nm)) {
          const u = new Uint8Array(await f.arrayBuffer());
          extractArchive(nm, u, out);
        } else if (/\.gz$/i.test(lower) && !lower.endsWith(".tar.gz")) {
          // single gzipped file -> lazy gunzip on demand
          const base = nm.replace(/\.gz$/i, "");
          out.push({ name: base, size: f.size, load: async () => gunzip(new Uint8Array(await f.arrayBuffer())).slice().buffer });
        } else if (isStdfName(nm)) {
          out.push({ name: nm, size: f.size, load: () => f.arrayBuffer() }); // lazy raw
        }
      } catch (e) { console.warn("import failed:", nm, e); }
    }
    return out;
  }

  // ---- folder traversal for drag-drop ----
  function walk(entry, out) {
    return new Promise(res => {
      if (entry.isFile) entry.file(f => { out.push(f); res(); }, () => res());
      else if (entry.isDirectory) {
        const rd = entry.createReader();
        const readAll = () => rd.readEntries(async ents => {
          if (!ents.length) return res();
          for (const en of ents) await walk(en, out);
          readAll();
        }, () => res());
        readAll();
      } else res();
    });
  }
  async function filesFromDataTransfer(dt) {
    const items = dt.items;
    if (items && items.length && items[0].webkitGetAsEntry) {
      const entries = [];
      for (const it of items) { const e = it.webkitGetAsEntry && it.webkitGetAsEntry(); if (e) entries.push(e); }
      if (entries.length) { const files = []; for (const e of entries) await walk(e, files); if (files.length) return files; }
    }
    return [...dt.files];
  }

  global.STDFImport = {
    collect,
    async fromDataTransfer(dt) { return collect(await filesFromDataTransfer(dt)); }
  };
})(window);
