module.exports = function (grunt) {
  // Load in the shared test config
  require('./grunt')(grunt);

  // Destination templating (twolfson/grunt-zip#6)
  var zipConfig = grunt.config.get('zip');
  grunt.config.set('zip', Object.assign(zipConfig, {
    'actual/template_zip/<%= pkg.version %>.zip': ['test_files/file.js']
  }));
};
