/*
 * grunt-zip
 * https://github.com/twolfson/grunt-zip
 *
 * Copyright (c) 2013 Todd Wolfson
 * Licensed under the MIT license.
 */

var fs = require('fs'),
    path = require('path'),
    zipfile = require('../lib/zipfile');
module.exports = function(grunt) {
  // Resolve the target's source patterns and destination the way grunt-retro
  // did: the first file mapping, with `src` left unexpanded. grunt's own
  // expansion would apply our `cwd` option to the patterns, which is not
  // what `cwd` means here.
  function resolveTarget(task) {
    var file = task.files.length !== 0 ? task.files[0].orig : {};
    var data = task.data;
    var options = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
    var src = file.src === undefined ? [] : [].concat(file.src);
    return {src: src, dest: file.dest, options: options};
  }

  function expand(options, src, filter) {
    return grunt.file.expand(Object.assign({filter: filter}, options), src);
  }

  // Run an async task body, failing the task instead of leaving an unhandled
  // rejection (which used to hang grunt or crash node).
  function runAsync(task, fn) {
    var done = task.async();
    fn.call(task).then(done, function (err) {
      grunt.log.error(err && err.stack || String(err));
      done(false);
    });
  }

  grunt.registerMultiTask('zip', 'Zip files together', function() {
    runAsync(this, zipTask);
  });

  async function zipTask() {
    // Localize variables
    var t = resolveTarget(this),
        data = t.options,
        src = t.src,
        dest = t.dest,
        router = data.router;

    // Collect our file paths (folders get a trailing `/`, as before)
    var globOptions = {dot: data.dot},
        srcFolders = expand(globOptions, src, 'isDirectory').map(function (dir) {
          return dir === '/' ? dir : dir + '/';
        }),
        srcFiles = expand(globOptions, src, 'isFile');

    // If there is no router
    if (!router) {
      // Grab the cwd and return the relative path as our router
      var cwd = data.cwd || process.cwd(),
          separator = new RegExp(path.sep.replace('\\', '\\\\'), 'g');
      router = function routerFn (filepath) {
        // Join path via /
        // DEV: Files zipped on Windows need to use /  to have the same layout on Linux
        return path.relative(cwd, filepath).replace(separator, '/');
      };
    } else if (data.cwd) {
    // Otherwise, if a `cwd` was specified, throw a fit and leave
      grunt.fail.warn('grunt-zip does not accept `cwd` and `router` in the same config due to potential ordering complications. Please choose one.');
    }

    // Generate our zipper
    var zip = new zipfile.ZipWriter();

    // For each of the srcFolders
    srcFolders.forEach(function (folderpath) {
      // Route the folder
      var routedPath = router(folderpath);

      // If there is a folder, add it to the zip (allows for skipping)
      if (routedPath) {
        grunt.verbose.writeln('Adding folder: "' + folderpath + '" -> "' + routedPath + '"');
        zip.folder(routedPath);
      }
    });

    // For each of the srcFiles
    srcFiles.forEach(function (filepath) {
      // Read in the content and add it to the zip
      var input = fs.readFileSync(filepath),
          routedPath = router(filepath);

      // If it has a path, add it (allows for skipping)
      if (routedPath) {
        grunt.verbose.writeln('Adding file: "' + filepath + '" -> "' + routedPath + '"');
        zip.file(routedPath, input);
      }
    });

    // Create the destination directory
    var destDir = path.dirname(dest);
    grunt.file.mkdir(destDir);

    // Write out the content
    var output = zip.generate({compression: data.compression});
    fs.writeFileSync(dest, output);

    // Fail task if errors were logged.
    if (this.errorCount) { return false; }

    // Otherwise, print a success message.
    grunt.log.writeln('File "' + dest + '" created.');
  }

  function echo(a) {
    return a;
  }
  grunt.registerMultiTask('unzip', 'Unzip files into a folder', function() {
    runAsync(this, unzipTask);
  });

  async function unzipTask() {
    // Collect the filepaths we need
    var t = resolveTarget(this),
        data = t.options,
        srcFiles = grunt.file.expand(t.src),
        dest = t.dest,
        router = data.router || echo,
        checkCRC32 = data.checkCRC32 !== false;

    // Iterate over the srcFiles
    var filesWritten = false;
    for (var filepath of srcFiles) {
      // Read in the contents
      var input = fs.readFileSync(filepath);

      // Unzip it
      var entries = zipfile.readZip(input, {checkCRC32: checkCRC32});

      // Iterate over the files
      for (var fileObj of entries) {
        // Find the content
        var filename = fileObj.name,
            content = fileObj.data,
            routedName = router(filename);

        // If there is a file path (allows for skipping)
        if (routedName) {
          // Determine the filepath
          var filepath = path.join(dest, routedName);
          filesWritten = true;

          // If the routedName ends in a `/`, treat it as a/an (empty) directory
          // DEV: We use `/` over path.sep since it is consistently `/` across all platforms
          if (routedName.slice(-1) === '/') {
            grunt.verbose.writeln('Creating directory: "' + filepath + '"');
            grunt.file.mkdir(filepath);
          } else {
            // Create the destination directory
            var fileDir = path.dirname(filepath);

            // Write out the content
            grunt.file.mkdir(fileDir);
            if ((fileObj.unixPermissions & 0xf000) === 0xa000) {
              var target = content.toString('utf8');
              grunt.verbose.writeln('Creating symbolic link from: "' + filepath + '" to "' + target + '"');
              // fs.symlinkSync throws EEXIST if a file with the same name as the link already exists
              try {
                fs.unlinkSync(filepath);
              }
              catch (err) {
                if (err.code !== 'ENOENT') {
                  throw err;
                }
              }
              fs.symlinkSync(target, filepath);
            } else {
              grunt.verbose.writeln('Writing file: "' + filepath + '"');
              fs.writeFileSync(filepath, content, {mode: fileObj.unixPermissions});
            }
          }
        }
      }
    }

    // Fail task if errors were logged.
    if (this.errorCount) { return false; }

    // Otherwise, print a success message.
    if (filesWritten) {
      grunt.log.writeln('Created "' + dest + '" directory');
    } else {
      grunt.log.writeln('No files were found in source. "' + dest + '" has not been created.');
    }
  }

};
