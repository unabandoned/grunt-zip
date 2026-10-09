var {describe, it, before} = require('node:test');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');

var actual = function (p) { return path.join(h.dir, 'actual', p); };

describe('A grunt `unzip` task', function () {
  before(function () {
    h.cleanActual();
    var tasks = ['unzip:single', 'unzip:nested', 'unzip:router', 'unzip:skip-files', 'unzip:empty', 'unzip:permissioned'];
    if (process.platform !== 'win32') {
      tasks.push('unzip:symlinks');
    }
    h.runTasks(tasks);
  });

  it('extracts a single archive', function () {
    h.assertEqualFiles('single_unzip/a.js');
    h.assertEqualFiles('single_unzip/b.js');
  });

  it('extracts nested folders', function () {
    ['css/bootstrap-responsive.css', 'css/bootstrap-responsive.min.css', 'css/bootstrap.css',
      'css/bootstrap.min.css', 'img/glyphicons-halflings-white.png', 'img/glyphicons-halflings.png',
      'js/bootstrap.js', 'js/bootstrap.min.js'].forEach(function (f) {
      h.assertEqualFiles('nested_unzip/bootstrap/' + f);
    });
  });

  it('maps files to new locations with a `router`', function () {
    ['bootstrap-responsive.css', 'bootstrap-responsive.min.css', 'bootstrap.css', 'bootstrap.min.css',
      'glyphicons-halflings-white.png', 'glyphicons-halflings.png', 'bootstrap.js', 'bootstrap.min.js'].forEach(function (f) {
      h.assertEqualFiles('router_unzip/' + f);
    });
  });

  it('skips files the router returns nothing for', function () {
    h.assertEqualFiles('skip_files_unzip/bootstrap/img/glyphicons-halflings-white.png');
    h.assertEqualFiles('skip_files_unzip/bootstrap/img/glyphicons-halflings.png');
    h.assertEqualFiles('skip_files_unzip/bootstrap/js/bootstrap.js');
    h.assertEqualFiles('skip_files_unzip/bootstrap/js/bootstrap.min.js');
    h.assertNoFile('skip_files_unzip/bootstrap/css/bootstrap-responsive.css');
    h.assertNoFile('skip_files_unzip/bootstrap/css/bootstrap-responsive.min.css');
    h.assertNoFile('skip_files_unzip/bootstrap/css/bootstrap.css');
    h.assertNoFile('skip_files_unzip/bootstrap/css/bootstrap.min.css');
  });

  it('creates nested empty directories', function () {
    assert.strictEqual(fs.statSync(actual('empty/double_empty')).isDirectory(), true);
  });

  it('preserves UNIX permissions', { skip: process.platform === 'win32' }, function () {
    assert.strictEqual(fs.statSync(actual('permissioned/permissioned-file')).mode, 0o100600);
  });

  it('restores symbolic links and their targets', { skip: process.platform === 'win32' }, function () {
    assert.strictEqual(fs.lstatSync(actual('symlinks/file_link')).isSymbolicLink(), true);
    assert.strictEqual(fs.lstatSync(actual('symlinks/dir_link')).isSymbolicLink(), true);
    assert.strictEqual(fs.readFileSync(actual('symlinks/file_link'), 'utf8'), 'harpsichord\n');
    assert.deepStrictEqual(fs.readdirSync(actual('symlinks/dir_link')), ['file2']);
  });

  describe('CRC-32 checks', function () {
    before(function () {
      // A stored archive with one content byte flipped
      h.runTasks(['zip:single']);
      var archive = h.read('actual', 'single_zip/file.zip');
      var content = h.read('test_files', 'file.js');
      var dataStart = archive.indexOf(content);
      assert.ok(dataStart > 0);
      archive[dataStart] ^= 0xff;
      fs.writeFileSync(actual('bad_crc.zip'), archive);
    });

    it('fails the task on a CRC-32 mismatch by default', function () {
      var result = h.grunt(['unzip:bad-crc']);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stdout, /CRC32 mismatch/);
    });

    it('extracts anyway with `checkCRC32: false`', function () {
      h.runTasks(['unzip:bad-crc-unchecked']);
      assert.ok(fs.existsSync(actual('bad_crc_unchecked/test_files/file.js')));
    });
  });

  describe('given entries that escape `dest` ("zip slip")', function () {
    var zipfile = require('../lib/zipfile');

    // Mark an entry as a Unix symlink (mode 0120777) in the central directory
    function asSymlink(archive, name) {
      var nameBuf = Buffer.from(name);
      for (var pos = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); pos >= 0;
        pos = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), pos - 1)) {
        var len = archive.readUInt16LE(pos + 28);
        if (archive.subarray(pos + 46, pos + 46 + len).equals(nameBuf)) {
          archive.writeUInt8(3, pos + 5);
          archive.writeUInt32LE((0o120777 << 16) >>> 0, pos + 38);
          return archive;
        }
      }
      throw new Error('no central entry for ' + name);
    }

    before(function () {
      fs.mkdirSync(actual('slip'), {recursive: true});
      fs.writeFileSync(actual('slip_dotdot.zip'),
        new zipfile.ZipWriter().file('../escaped.txt', 'pwned').generate());
      fs.writeFileSync(actual('slip_symlink.zip'),
        asSymlink(new zipfile.ZipWriter().file('link', '../..').generate(), 'link'));
    });

    it('refuses a `../` entry and writes nothing outside', function () {
      var result = h.grunt(['unzip:slip-dotdot']);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stdout, /outside/);
      assert.strictEqual(fs.existsSync(actual('slip/escaped.txt')), false);
    });

    it('refuses a symlink that points outside', function () {
      var result = h.grunt(['unzip:slip-symlink']);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stdout, /symlink pointing outside/);
      assert.strictEqual(fs.existsSync(actual('slip/dest/link')), false);
    });

    it('refuses to write through a symlink already in `dest`', {skip: process.platform === 'win32'}, function () {
      fs.mkdirSync(actual('slip/dest'), {recursive: true});
      fs.mkdirSync(actual('slip/outside'), {recursive: true});
      fs.rmSync(actual('slip/dest/out'), {force: true});
      fs.symlinkSync('../outside', actual('slip/dest/out'));
      fs.writeFileSync(actual('slip_through_symlink.zip'),
        new zipfile.ZipWriter().file('out/escaped.txt', 'pwned').generate());
      var result = h.grunt(['unzip:slip-through-symlink']);
      assert.notStrictEqual(result.status, 0);
      assert.match(result.stdout, /through a symlink/);
      assert.strictEqual(fs.existsSync(actual('slip/outside/escaped.txt')), false);
    });
  });
});
