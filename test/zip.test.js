var {describe, it, before} = require('node:test');
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var h = require('./helpers');

describe('A grunt `zip` task', function () {
  before(function () {
    h.cleanActual();
    h.runTasks([
      'zip:single', 'zip:multi',
      'zip:image', 'unzip:test-zip-image',
      'zip:nested', 'unzip:test-zip-nested',
      'zip:router', 'unzip:test-zip-router',
      'zip:cwd', 'unzip:test-zip-cwd',
      'zip:dot', 'unzip:test-zip-dot',
      'zip:skip-files', 'unzip:test-zip-skip-files',
      'zip:deflate', 'unzip:test-zip-deflate',
      'zip:cwd-glob',
      'zip:actual/template_zip/<%= pkg.version %>.zip'
    ]);
  });

  it('zips a single file', async function () {
    await h.assertSameArchive('single_zip/file.zip');
  });

  it('zips multiple files', async function () {
    await h.assertSameArchive('multi_zip/file.zip');
  });

  it('does not corrupt a binary file (image)', function () {
    h.assertEqualFiles('image_zip/unzip/test_files/smile.gif');
  });

  it('saves nested folders', function () {
    h.assertEqualFiles('nested_zip/unzip/test_files/nested/hello.js');
    h.assertEqualFiles('nested_zip/unzip/test_files/nested/world.txt');
    h.assertEqualFiles('nested_zip/unzip/test_files/nested/glyphicons-halflings.png');
    h.assertEqualFiles('nested_zip/unzip/test_files/nested/nested2/hello10.txt');
    h.assertEqualFiles('nested_zip/unzip/test_files/nested/nested2/hello20.js');
  });

  it('routes files with a `router`', function () {
    h.assertEqualFiles('router_zip/unzip/hello.js');
    h.assertEqualFiles('router_zip/unzip/hello10.txt');
  });

  it('adjusts file paths with `cwd`', function () {
    h.assertEqualFiles('cwd_zip/unzip/hello.js');
    h.assertEqualFiles('cwd_zip/unzip/nested2/hello10.txt');
  });

  it('saves dot files', function () {
    h.assertEqualFiles('dot_zip/unzip/test_files/dot/.test/hello.js');
    h.assertEqualFiles('dot_zip/unzip/test_files/dot/test/.examplerc');
  });

  it('skips files the router returns nothing for', function () {
    h.assertEqualFiles('skip_files_zip/unzip/test_files/nested/hello.js');
    h.assertNoFile('skip_files_zip/unzip/test_files/nested/nested2/hello10.txt');
  });

  it('compresses with DEFLATE and extracts the same files', async function () {
    var stored = await h.entries('actual', 'nested_zip/file.zip');
    var deflated = await h.entries('actual', 'deflate_zip/file.zip');
    assert.deepStrictEqual(deflated, stored);
    var archive = h.read('actual', 'deflate_zip/file.zip');
    var header = archive.indexOf('test_files/nested/hello.js') - 30;
    assert.strictEqual(archive.readUInt32LE(header), 0x04034b50);
    assert.strictEqual(archive.readUInt16LE(header + 8), 8, 'files use DEFLATE');
    assert.ok(archive.length < h.read('actual', 'nested_zip/file.zip').length);
    assert.ok(h.read('actual', 'deflate_zip/unzip/test_files/nested/glyphicons-halflings.png')
      .equals(h.read('test_files', 'nested/glyphicons-halflings.png')));
  });

  it('zips patterns rooted above `cwd`, with negations, the way CyberChef does', async function () {
    var names = (await h.entries('actual', 'cwd_glob_zip/file.zip')).map(function (e) { return e[0]; });
    assert.deepStrictEqual(names, [
      'nested2/',
      'glyphicons-halflings.png',
      'hello.js',
      'nested2/hello10.txt',
      'nested2/hello20.js'
    ]);
  });

  it('expands templates in the destination', function () {
    var version = require('../package.json').version;
    assert.ok(fs.existsSync(path.join(h.dir, 'actual/template_zip', version + '.zip')));
  });
});
