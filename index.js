var es = require('event-stream');
var Vinyl = require('vinyl');
var PluginError = require('plugin-error');
var sharp = require('sharp');
var _ = require('lodash');
var path = require('path');

// consts
const PLUGIN_NAME = 'gulp-sharp';
const PLUGIN_DEBUG = false;

var replaceExt = function (pathStr, ext) {
  return path.join(
    path.dirname(pathStr),
    path.basename(pathStr, path.extname(pathStr)) + ext);
};

var execute = function ( obj, task ) {

  var methodName = task[0];
  var passedValue = task[1];

  if (!obj[ methodName ]) {
    console.error(`No sharp method '${methodName}' found`)
    return obj;
  }

  if (_.isArray(passedValue)) {
    return obj[ methodName ].apply(this, passedValue); // `this` will be binded later at runtime
  }

  return obj[ methodName ]( passedValue );
};

var getRotate = function( val ){
  if (_.isBoolean(val) && val === false) {
    return false;
  } else if (_.isBoolean(val) && val === true) {
    return ['rotate', undefined];
  } else {
    return ['rotate', val];
  }
};

var createSharpPipeline = function( opts ) {
  // create pipeline manually to preserve consistency
  var pipeline = [];
  for (var exec in opts) {
    pipeline.push([exec, opts[exec]]);
  }

  // remove task that is undefined
  pipeline = _.compact(pipeline);

  return async function( file ){

    var promises = null;
    var input = null;

    input = sharp(file.isNull() ? file.path : file.contents, {sequentialRead: true});

    var executeInstance = execute.bind(input);

    var metadata = await input.metadata()

    var transform = _.reduce( pipeline, function(accumulator, task){
      if (task[0] === 'scale') {
        const resizeTask = [
          'resize',
          [
            metadata.width * task[1][0],
            null,
            task[1][1]
          ]
        ]
        task = resizeTask
      }
      return executeInstance(accumulator, task);
    }, input);

    if (opts.output) {
      transform = transform[opts.output]();
    }

    promises = transform.toBuffer();
    return promises;
  };
};

// plugin level function (dealing with files)
var gulpSharp = function( options ) {

  if ( options === undefined ) {
    throw new PluginError(PLUGIN_NAME, 'Missing options object');
  } else if ( ! _.isPlainObject(options) ) {
    throw new PluginError(PLUGIN_NAME, 'options object must be plain object (created with `{}` literal) ');
  } else if ( options.resize === undefined && options.extract === undefined && options.scale === undefined ) {
    throw new PluginError(PLUGIN_NAME, 'Please specify an extract, resize or scale property in your options object');
  } else if ( options.resize && Array.isArray( options.resize ) === false ) {
    throw new PluginError(PLUGIN_NAME, 'options.resize must be array');
  }

  // default options
  var DEFAULT = {};

  var mergedOptions = _.merge(DEFAULT, options);
  var pipeline = createSharpPipeline(mergedOptions);
  if(PLUGIN_DEBUG) console.log(pipeline);
  // creating a stream through which each file will pass
  var stream = es.map(function(file, callback) {
    if(PLUGIN_DEBUG) console.log(file);
    if (file.isStream()) {
      callback(new PluginError(PLUGIN_NAME, 'Streams are not supported.'));
    }

    pipeline(file).then(
      function(outputBuffer){ // onFulfilled
        var newFile = new Vinyl({
          'cwd' : file.cwd,
          'base' : file.base,
          'path' : file.path,
          'contents' : outputBuffer
        });

        if (mergedOptions.output) {
          // change file extension
          newFile.path = replaceExt(newFile.path, '.' + mergedOptions.output);
        }

        callback(null, newFile);
      },
      function(error){ // onRejected
        callback(error);
      }
    );
  });

  // returning the file stream
  return stream;
};

// exporting the plugin main function
module.exports = gulpSharp;
