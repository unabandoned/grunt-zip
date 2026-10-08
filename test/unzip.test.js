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
});
