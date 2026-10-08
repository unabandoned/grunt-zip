// Shared helpers for the grunt-zip tests: run grunt in this directory and
// compare outputs against the fixtures in `expected/`.
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var childProcess = require('child_process');
var JSZip = require('jszip');

var gruntBin = require.resolve('grunt/bin/grunt');

exports.dir = __dirname;

exports.grunt = function (tasks) {
  return childProcess.spawnSync(process.execPath, [gruntBin, '--no-color'].concat(tasks), {
    cwd: __dirname,
    encoding: 'utf8'
  });
};

exports.runTasks = function (tasks) {
  var result = exports.grunt(tasks);
  assert.strictEqual(result.status, 0, 'grunt ' + tasks.join(' ') + ' failed:\n' + result.stdout + result.stderr);
  return result;
};

exports.cleanActual = function () {
  fs.rmSync(path.join(__dirname, 'actual'), {recursive: true, force: true});
};

exports.read = function (base, filename) {
  return fs.readFileSync(path.join(__dirname, base, filename));
};

exports.assertEqualFiles = function (filename) {
  assert.ok(exports.read('actual', filename).equals(exports.read('expected', filename)),
    filename + ' does not have the same content in `expected` as `actual`');
};

exports.assertNoFile = function (filename) {
  assert.strictEqual(fs.existsSync(path.join(__dirname, 'actual', filename)), false, filename + ' exists');
};

// Summarise an archive as [name, isDir, content] in archive order
exports.entries = async function (base, filename) {
  var zip = await JSZip.loadAsync(exports.read(base, filename), {checkCRC32: true});
  var out = [];
  for (var name of Object.keys(zip.files)) {
    var entry = zip.files[name];
    out.push([name, entry.dir, (await entry.async('nodebuffer')).toString('latin1')]);
  }
  return out;
};

// Upstream compared zips by edit distance because jszip stamps the current
// time into each entry; compare the decoded entries instead.
exports.assertSameArchive = async function (filename) {
  assert.deepStrictEqual(await exports.entries('actual', filename), await exports.entries('expected', filename));
};
