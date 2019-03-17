#!/usr/bin/env node
'use strict';

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var fs = require('fs');
var fs__default = _interopDefault(fs);
var yargs = _interopDefault(require('yargs'));
var findUp = _interopDefault(require('find-up'));
var path = require('path');
var child_process = require('child_process');

var node = path.join(__dirname, '../../node_modules/@babel/node/bin/babel-node.js --presets @babel/preset-react,@babel/preset-env');

var tempFileName = function tempFileName(parentDirectory) {
  var suffix = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : '';
  return path.join(parentDirectory, "".concat(Math.random(), ".temp").concat(suffix));
};

var regexp = /[^\s"]+|"([^"]*)"/gi;
var command = 'build <template> <destination>';
var describe = 'Build a file tree from template into destination directory';
var builder = {
  test: {
    type: 'boolean',
    default: true,
    desc: 'write to console instead of fs'
  },
  input: {
    type: 'string',
    default: '',
    desc: 'imported input file (must export iterator)'
  }
};

var localizer = function localizer(path$1) {
  var defaultPath = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : undefined;
  return path$1 ? path.join(process.cwd(), path$1) : defaultPath;
};

var handler = function handler(_ref) {
  var t = _ref.template,
      d = _ref.destination,
      i = _ref.input,
      test = _ref.test;
  var tempname = tempFileName(__dirname, '.js');

  try {
    var template = localizer(t);
    var destination = localizer(d || tempFileName('', ''));
    var input = localizer(i);
    var template_context = path.dirname(template);
    var file = "import template from '".concat(template, "';\nimport {render").concat(test ? 'Console' : 'FS', " as render} from \"../../dist/lib/index.js\";\n").concat(input ? "import input from \"".concat(input, "\";\n") : '', "\nconst main = async()=>{\nrender(await template(").concat(input ? '...input' : '', "), {folder_context:['").concat(destination, "'], template_context:'").concat(template_context, "'});\n}\nmain();\n");
    fs__default.writeFileSync(tempname, file);
    var array = [];
    var match; //https://stackoverflow.com/questions/2817646/javascript-split-string-on-space-or-on-quotes-to-array

    do {
      match = regexp.exec("".concat(node, " ").concat(tempname));

      if (match !== null) {
        array.push(match[1] ? match[1] : match[0]);
      }
    } while (match !== null);

    var ps = child_process.spawn(array.shift(), array, {
      stdio: 'inherit'
    });
    ps.on('close', function () {
      fs__default.unlinkSync(tempname);
    });
  } catch (error) {
    if (fs__default.existsSync(tempname)) {
      fs__default.unlinkSync(tempname);
    }

    throw error;
  }
};

var build = /*#__PURE__*/Object.freeze({
    command: command,
    describe: describe,
    builder: builder,
    handler: handler
});

var configPath = findUp.sync(['.fileable', '.fileable.json']);
var config = configPath ? JSON.parse(fs.readFileSync(configPath)) : {};
yargs.config(config).command(build).demandCommand().help().argv;
