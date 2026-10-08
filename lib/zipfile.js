/*
 * Minimal ZIP reader/writer built on node:zlib.
 *
 * Replaces jszip for the subset grunt-zip uses: STORE and DEFLATE entries,
 * folder entries, UTF-8 names, CRC-32 checks, UNIX permissions and ZIP64
 * archives on read. Archives are written as single-disk, non-ZIP64 files
 * made by "DOS", which is what jszip produced for grunt-zip.
 */
'use strict';

var zlib = require('zlib');

var SIG_LOCAL = 0x04034b50;
var SIG_CENTRAL = 0x02014b50;
var SIG_EOCD = 0x06054b50;
var SIG_ZIP64_EOCD = 0x06064b50;
var SIG_ZIP64_LOCATOR = 0x07064b50;

var METHODS = {STORE: 0, DEFLATE: 8};
var MADE_BY_DOS = 0x00;
var MADE_BY_UNIX = 0x03;
var FLAG_ENCRYPTED = 0x0001;
var FLAG_UTF8 = 0x0800;
var MAX_32 = 0xffffffff;
var MAX_16 = 0xffff;

function toDosDateTime(date) {
  var year = date.getFullYear();
  if (year < 1980) {
    return {time: 0, date: (1 << 5) | 1};
  }
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  };
}

function fromDosDateTime(time, date) {
  return new Date(
    ((date >> 9) & 0x7f) + 1980, ((date >> 5) & 0x0f) - 1, date & 0x1f,
    (time >> 11) & 0x1f, (time >> 5) & 0x3f, (time & 0x1f) * 2
  );
}

function parentFolder(name) {
  if (name.slice(-1) === '/') {
    name = name.slice(0, -1);
  }
  var index = name.lastIndexOf('/');
  return index > 0 ? name.slice(0, index + 1) : '';
}

// Collects entries in insertion order. Like jszip, adding `a/b/c.js` also
// adds the `a/` and `a/b/` folder entries ahead of it, and re-adding an
// existing name replaces its content but keeps its position.
function ZipWriter() {
  this.entries = new Map();
}

ZipWriter.prototype.folder = function (name) {
  if (name.slice(-1) !== '/') {
    name += '/';
  }
  if (!this.entries.has(name)) {
    this._parents(name);
    this.entries.set(name, {name: name, dir: true, data: Buffer.alloc(0)});
  }
  return this;
};

ZipWriter.prototype.file = function (name, data) {
  this._parents(name);
  this.entries.set(name, {name: name, dir: false, data: Buffer.from(data)});
  return this;
};

ZipWriter.prototype._parents = function (name) {
  var parent = parentFolder(name);
  if (parent) {
    this.folder(parent);
  }
};

// options.compression: 'STORE' (default) or 'DEFLATE'
// options.date: modification time stamped on every entry (default: now)
ZipWriter.prototype.generate = function (options) {
  options = options || {};
  var compression = String(options.compression || 'STORE').toUpperCase();
  if (!Object.prototype.hasOwnProperty.call(METHODS, compression)) {
    throw new Error(compression + ' is not a valid compression method !');
  }
  var dos = toDosDateTime(options.date || new Date());
  var locals = [];
  var centrals = [];
  var offset = 0;

  if (this.entries.size > MAX_16) {
    throw new Error('Too many entries for a non-ZIP64 archive: ' + this.entries.size);
  }

  this.entries.forEach(function (entry) {
    var name = Buffer.from(entry.name, 'utf8');
    var method = entry.dir ? METHODS.STORE : METHODS[compression];
    var body = method === METHODS.DEFLATE ? zlib.deflateRawSync(entry.data) : entry.data;
    var crc = zlib.crc32(entry.data);
    var flags = /[^\x00-\x7f]/.test(entry.name) ? FLAG_UTF8 : 0;

    if (entry.data.length > MAX_32 || body.length > MAX_32 || offset > MAX_32) {
      throw new Error('Archive too large for a non-ZIP64 archive at "' + entry.name + '"');
    }

    var local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(method === METHODS.DEFLATE ? 20 : 10, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dos.time, 10);
    local.writeUInt16LE(dos.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    var central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE((MADE_BY_DOS << 8) | 20, 4);
    local.copy(central, 6, 4, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(entry.dir ? 0x10 : 0, 38);
    central.writeUInt32LE(offset, 42);

    locals.push(local, name, body);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  });

  var centralDir = Buffer.concat(centrals);
  if (offset > MAX_32) {
    throw new Error('Archive too large for a non-ZIP64 archive');
  }
  var eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(this.entries.size, 8);
  eocd.writeUInt16LE(this.entries.size, 10);
  eocd.writeUInt32LE(centralDir.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat(locals.concat([centralDir, eocd]));
};

function corrupted(message) {
  return new Error('Corrupted zip: ' + message);
}

function findEocd(buf) {
  var stop = Math.max(0, buf.length - 22 - MAX_16);
  for (var i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      return i;
    }
  }
  throw corrupted("can't find end of central directory. Is this a zip file?");
}

function readExtraFields(buf, start, end) {
  var fields = {};
  while (start + 4 <= end) {
    var id = buf.readUInt16LE(start);
    var size = buf.readUInt16LE(start + 2);
    fields[id] = buf.subarray(start + 4, Math.min(start + 4 + size, end));
    start += 4 + size;
  }
  return fields;
}

// Returns entries in central-directory order:
// {name, dir, date, unixPermissions, dosPermissions, data: Buffer}
function readZip(buf, options) {
  options = options || {};
  buf = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  var eocd = findEocd(buf);
  var count = buf.readUInt16LE(eocd + 10);
  var cdOffset = buf.readUInt32LE(eocd + 16);

  // ZIP64: the locator sits right before the classic EOCD record
  var locator = eocd - 20;
  if (locator >= 0 && buf.readUInt32LE(locator) === SIG_ZIP64_LOCATOR) {
    var z64 = Number(buf.readBigUInt64LE(locator + 8));
    if (buf.readUInt32LE(z64) !== SIG_ZIP64_EOCD) {
      throw corrupted("can't find the ZIP64 end of central directory");
    }
    count = Number(buf.readBigUInt64LE(z64 + 32));
    cdOffset = Number(buf.readBigUInt64LE(z64 + 48));
  }

  var entries = [];
  var pos = cdOffset;
  for (var n = 0; n < count; n++) {
    if (pos + 46 > buf.length || buf.readUInt32LE(pos) !== SIG_CENTRAL) {
      throw corrupted("can't find central directory entry " + n);
    }
    var madeBy = buf.readUInt8(pos + 5);
    var flags = buf.readUInt16LE(pos + 8);
    var method = buf.readUInt16LE(pos + 10);
    var time = buf.readUInt16LE(pos + 12);
    var date = buf.readUInt16LE(pos + 14);
    var crc = buf.readUInt32LE(pos + 16);
    var compressedSize = buf.readUInt32LE(pos + 20);
    var size = buf.readUInt32LE(pos + 24);
    var nameLen = buf.readUInt16LE(pos + 28);
    var extraLen = buf.readUInt16LE(pos + 30);
    var commentLen = buf.readUInt16LE(pos + 32);
    var externalAttrs = buf.readUInt32LE(pos + 38);
    var localOffset = buf.readUInt32LE(pos + 42);
    var nameStart = pos + 46;
    var extras = readExtraFields(buf, nameStart + nameLen, nameStart + nameLen + extraLen);
    var name = buf.toString('utf8', nameStart, nameStart + nameLen);
    pos = nameStart + nameLen + extraLen + commentLen;

    // ZIP64 extended information: only the fields that overflowed are present
    if (extras[0x0001]) {
      var z = extras[0x0001], zi = 0;
      if (size === MAX_32) { size = Number(z.readBigUInt64LE(zi)); zi += 8; }
      if (compressedSize === MAX_32) { compressedSize = Number(z.readBigUInt64LE(zi)); zi += 8; }
      if (localOffset === MAX_32) { localOffset = Number(z.readBigUInt64LE(zi)); }
    }
    // Info-ZIP Unicode Path: use it when its CRC matches the stored name
    var upath = extras[0x7075];
    if (upath && upath.length > 5 && upath.readUInt32LE(1) === zlib.crc32(buf.subarray(nameStart, nameStart + nameLen))) {
      name = upath.toString('utf8', 5);
    }

    if (flags & FLAG_ENCRYPTED) {
      throw new Error('Encrypted zip are not supported');
    }
    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw corrupted("can't find local header for " + name);
    }
    var dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    var raw = buf.subarray(dataStart, dataStart + compressedSize);
    var data;
    if (method === METHODS.STORE) {
      data = Buffer.from(raw);
    } else if (method === METHODS.DEFLATE) {
      data = zlib.inflateRawSync(raw);
    } else {
      throw corrupted('compression method ' + method + ' unknown (inside ' + name + ')');
    }
    if (data.length !== size) {
      throw corrupted('uncompressed size mismatch (inside ' + name + ')');
    }
    if (options.checkCRC32 && zlib.crc32(data) !== crc) {
      throw corrupted('CRC32 mismatch (inside ' + name + ')');
    }

    var dir = (externalAttrs & 0x10) !== 0 || name.slice(-1) === '/';
    if (dir && name.slice(-1) !== '/') {
      name += '/';
    }
    entries.push({
      name: name,
      dir: dir,
      date: fromDosDateTime(time, date),
      unixPermissions: madeBy === MADE_BY_UNIX ? (externalAttrs >>> 16) & 0xffff : null,
      dosPermissions: madeBy === MADE_BY_DOS ? externalAttrs & 0x3f : null,
      data: data
    });
  }
  return entries;
}

module.exports = {ZipWriter: ZipWriter, readZip: readZip};
